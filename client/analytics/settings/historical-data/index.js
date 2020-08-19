/**
 * External dependencies
 */
import { __ } from '@wordpress/i18n';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';
import { Component } from '@wordpress/element';
import { compose } from '@wordpress/compose';
import moment from 'moment';
import { IMPORT_STORE_NAME, NOTES_STORE_NAME } from '@woocommerce/data';
import { withDispatch } from '@wordpress/data';
import { withSpokenMessages } from '@wordpress/components';
import { SECOND } from '@fresh-data/framework';

/**
 * Internal dependencies
 */
import { formatParams } from './utils';
import HistoricalDataLayout from './layout';
import { QUERY_DEFAULTS } from '../../../wc-api/constants';
import { recordEvent } from '../../../lib/tracks';
import withSelect from '../../../wc-api/with-select';

class HistoricalData extends Component {
	constructor() {
		super( ...arguments );

		this.dateFormat = __( 'MM/DD/YYYY', 'woocommerce-admin' );
		this.intervalId = -1;
		this.fetching = false;

		this.state = {
			// Whether there is an active import (which might have been stopped)
			// that matches the period and skipChecked settings
			activeImport: null,
			lastImportStartTimestamp: 0,
			lastImportStopTimestamp: 0,
			period: {
				date: moment().format( this.dateFormat ),
				label: 'all',
			},
			skipChecked: true,
		};

		this.makeQuery = this.makeQuery.bind( this );
		this.onImportFinished = this.onImportFinished.bind( this );
		this.onImportStarted = this.onImportStarted.bind( this );
		this.onDeletePreviousData = this.onDeletePreviousData.bind( this );
		this.onReimportData = this.onReimportData.bind( this );
		this.onStartImport = this.onStartImport.bind( this );
		this.onStopImport = this.onStopImport.bind( this );
		this.onDateChange = this.onDateChange.bind( this );
		this.onPeriodChange = this.onPeriodChange.bind( this );
		this.onSkipChange = this.onSkipChange.bind( this );
		this.startStatusCheckInterval = this.startStatusCheckInterval.bind(
			this
		);
		this.cancelStatusCheckInterval = this.cancelStatusCheckInterval.bind(
			this
		);
	}

	startStatusCheckInterval() {
		const query = this.getImportStatusRequirement();
		const { timeout } = query;
		if ( this.intervalId < 0 ) {
			this.intervalId = setInterval( () => {
				this.clearCache( 'getImportStatus', query );
			}, timeout );
		}
	}

	cancelStatusCheckInterval() {
		clearInterval( this.intervalId );
		this.intervalId = -1;
	}

	clearCache( resolver, query ) {
		const { invalidateResolution } = this.props;
		invalidateResolution( resolver, [ query ] );
	}

	getImportStatusRequirement() {
		const { lastImportStartTimestamp } = this.state;
		const requirement = {
			freshness: 3 * SECOND,
			timeout: 3 * SECOND,
		};
		return { ...requirement, timestamp: lastImportStartTimestamp };
	}

	makeQuery( path, errorMessage ) {
		const { createNotice } = this.props;
		this.fetching = true;
		apiFetch( { path, method: 'POST' } )
			.then( ( response ) => {
				if ( response.status === 'success' ) {
					this.fetching = false;
					createNotice( 'success', response.message );
				} else {
					createNotice( 'error', errorMessage );
					this.setState( {
						activeImport: false,
						lastImportStopTimestamp: Date.now(),
					} );
				}
			} )
			.catch( ( error ) => {
				if ( error && error.message ) {
					createNotice( 'error', error.message );
					this.setState( {
						activeImport: false,
						lastImportStopTimestamp: Date.now(),
					} );
				}
			} );
	}

	onImportFinished() {
		if ( ! this.fetching ) {
			const { debouncedSpeak } = this.props;
			debouncedSpeak( 'Import complete' );
			this.cancelStatusCheckInterval();
			this.setState( {
				lastImportStopTimestamp: Date.now(),
			} );
		}
	}

	onImportStarted() {
		const { notes, updateNote } = this.props;

		const historicalDataNote = notes.find(
			( note ) => note.name === 'wc-admin-historical-data'
		);
		if ( historicalDataNote ) {
			updateNote( historicalDataNote.id, { status: 'actioned' } );
		}

		this.setState( {
			activeImport: true,
			lastImportStartTimestamp: Date.now(),
		} );
	}

	onDeletePreviousData() {
		const path = '/wc-analytics/reports/import/delete';
		const errorMessage = __(
			'There was a problem deleting your previous data.',
			'woocommerce-admin'
		);
		this.makeQuery( path, errorMessage );
		this.setState( {
			activeImport: false,
		} );
		recordEvent( 'analytics_import_delete_previous' );
	}

	onReimportData() {
		const { lastImportStartTimestamp, period, skipChecked } = this.state;
		const params = formatParams( this.dateFormat, period, skipChecked );

		// We need to clear the cache of the selectors `getImportTotals` and `getImportStatus`
		this.clearCache( 'getImportTotals', {
			...params,
			timestamp: lastImportStartTimestamp,
		} );
		this.clearCache( 'getImportStatus', this.getImportStatusRequirement() );
		this.setState( {
			activeImport: false,
		} );
	}

	onStartImport() {
		const { period, skipChecked } = this.state;
		const path = addQueryArgs(
			'/wc-analytics/reports/import',
			formatParams( this.dateFormat, period, skipChecked )
		);
		const errorMessage = __(
			'There was a problem rebuilding your report data.',
			'woocommerce-admin'
		);
		const startingImport = true;
		this.makeQuery( path, errorMessage, startingImport );
		this.onImportStarted();
	}

	onStopImport() {
		this.cancelStatusCheckInterval();
		this.setState( {
			lastImportStopTimestamp: Date.now(),
		} );
		const path = '/wc-analytics/reports/import/cancel';
		const errorMessage = __(
			'There was a problem stopping your current import.',
			'woocommerce-admin'
		);
		this.makeQuery( path, errorMessage );
	}

	onPeriodChange( val ) {
		this.setState( {
			activeImport: false,
			period: {
				...this.state.period,
				label: val,
			},
		} );
	}

	onDateChange( val ) {
		this.setState( {
			activeImport: false,
			period: {
				date: val,
				label: 'custom',
			},
		} );
	}

	onSkipChange( val ) {
		this.setState( {
			activeImport: false,
			skipChecked: val,
		} );
	}

	render() {
		const {
			activeImport,
			lastImportStartTimestamp,
			lastImportStopTimestamp,
			period,
			skipChecked,
		} = this.state;
		const { createNotice } = this.props;

		return (
			<HistoricalDataLayout
				activeImport={ activeImport }
				createNotice={ createNotice }
				dateFormat={ this.dateFormat }
				onImportFinished={ this.onImportFinished }
				onImportStarted={ this.onImportStarted }
				lastImportStartTimestamp={ lastImportStartTimestamp }
				lastImportStopTimestamp={ lastImportStopTimestamp }
				onPeriodChange={ this.onPeriodChange }
				onDateChange={ this.onDateChange }
				onSkipChange={ this.onSkipChange }
				onDeletePreviousData={ this.onDeletePreviousData }
				onReimportData={ this.onReimportData }
				onStartImport={ this.onStartImport }
				onStopImport={ this.onStopImport }
				period={ period }
				skipChecked={ skipChecked }
				startStatusCheckInterval={ this.startStatusCheckInterval }
				cancelStatusCheckInterval={ this.cancelStatusCheckInterval }
			/>
		);
	}
}

export default compose( [
	withSelect( ( select ) => {
		const { getNotes } = select( NOTES_STORE_NAME );

		const notesQuery = {
			page: 1,
			per_page: QUERY_DEFAULTS.pageSize,
			type: 'update',
			status: 'unactioned',
		};
		const notes = getNotes( notesQuery );

		return { notes };
	} ),
	withDispatch( ( dispatch ) => {
		const { updateNote } = dispatch( NOTES_STORE_NAME );
		const { invalidateResolution } = dispatch( IMPORT_STORE_NAME );

		return { invalidateResolution, updateNote };
	} ),
	withSpokenMessages,
] )( HistoricalData );
