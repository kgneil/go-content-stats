if ( 'undefined' == typeof go_content_stats ) {
	var go_content_stats = {
		// endpoint is set from a wp_localize_script. If we get into here, we're in a bad place
		endpoint: ''
	};
}//end if

( function ( $ ) {
	// initialize the event object
	go_content_stats.event = {};

	// initialize the store object
	go_content_stats.store = {
		ttl: 24 * 60 * 60 * 100
	};

	// holds the current loaded stats
	go_content_stats.stats = {};
	go_content_stats.summary = {};

	go_content_stats.gaps = {
		general: [],
		pvs: []
	};

	go_content_stats.init = function() {
		this.graph.init();

		this.blockui_args = {
			message: '<i class="fa fa-spinner fa-spin"></i>',
			css: {
				background: 'transparent',
				border: '0',
				top: '10%'
			}
		};
		this.$date_range = $( '#date-range' );
		this.$filters = $( '#content-stats .filters' );
		this.$start = $( '#go-content-stats-start' );
		this.$end = $( '#go-content-stats-end' );
		this.$zoom_levels = $( '#zoom-levels' );
		this.$stat_data = $( '#stat-data' );
		this.$taxonomy_data = $( '#taxonomy-data' );

		this.$date_range.daterangepicker( {
			startDate: moment( this.$start.val() ),
			endDate: moment( this.$end.val() ),
			ranges: {
				'Last 7 days': [ moment().subtract( 'days', 6 ), moment() ],
				'Last 30 days': [ moment().subtract( 'days', 29 ), moment() ],
				'This week': [ moment().startOf( 'week' ), moment() ],
				'Last week': [ moment().subtract( 'week', 1 ).startOf( 'week' ), moment().subtract( 'week', 1 ).endOf( 'week' ) ],
				'This month': [ moment().startOf( 'month' ), moment().endOf( 'month' ) ],
				'Last month': [ moment().subtract( 'month', 1 ).startOf( 'month' ), moment().subtract( 'month', 1 ).endOf( 'month' ) ]
			}
		},
		function( start, end ) {
			go_content_stats.$date_range.find( 'span' ).html( start.format( 'MMMM D, YYYY' ) + ' - ' + end.format( 'MMMM D, YYYY' ) );
			go_content_stats.$start.val( start.format( 'YYYY-MM-DD' ) );
			go_content_stats.$end.val( end.format( 'YYYY-MM-DD' ) );
			go_content_stats.push_state();
		} );

		this.period = this.get_period();
		this.context = this.get_context();
		this.zoom = this.get_zoom();

		// this registers a handlebars helper so we can output formatted numbers
		// rounded to 1 decimal
		Handlebars.registerHelper( 'number_format', this.number_format );

		// load stats for the current page
		this.prep_stats();

		$( document ).on( 'click', '#go-content-stats-clear-cache', this.event.clear_cache );
		$( document ).on( 'click', '#criteria a', this.event.select_criteria );
		$( document ).on( 'click', '.stat-row a', this.event.fetch_posts );
		$( document ).on( 'click', '#content-stats .filters .remove', this.event.remove_criteria );
		$( document ).on( 'click', '#zoom-levels button', this.event.select_zoom );
		$( document ).on( 'go-content-stats-insert', this.event.mind_the_gap );
		$( document ).on( 'go-content-stats-update', this.event.mind_the_gap );
		$( window ).on( 'popstate', this.event.change_state );
	};

	go_content_stats.remove_criteria = function () {
		$( '#go-content-stats-type' ).val( '' );
		$( '#go-content-stats-key' ).val( '' );
		$( '#content-stats .filters' ).html( '' );

		this.context = {
			type: '',
			key: ''
		};

		this.push_state();
	};

	go_content_stats.select_criteria = function ( criteria ) {
		this.context = criteria;

		$( '#go-content-stats-type' ).val( this.context.type );
		$( '#go-content-stats-key' ).val( this.context.key );

		this.push_state();

		var source = $( '#filter-template' ).html();
		var template = Handlebars.compile( source );

		this.$filters.html( template( criteria ) );

		$( 'html, body' ).animate( {
			scrollTop: 0
		}, 300 );
	};

	/**
	 * selects a zoom level
	 */
	go_content_stats.select_zoom = function( zoom_level ) {
		var $current = this.$zoom_levels.find( '.active' );

		if ( zoom_level === $current.data( 'zoom-level' ) ) {
			return;
		}//end if

		this.$zoom_levels.find( 'button' ).removeClass( 'active' );
		this.$zoom_levels.find( '[data-zoom-level="' + zoom_level + '"]' ).addClass( 'active' );

		this.push_state();
	};

	/**
	 * push a state change
	 */
	go_content_stats.push_state = function () {
		var period = this.get_period();
		var context = this.get_context();
		var zoom = this.get_zoom();

		history.pushState( period, '', 'index.php?page=go-content-stats&type=' + context.type + '&key=' + context.key + '&start=' + period.start + '&end=' + period.end + '&zoom=' + zoom );
		this.change_state( period );
	};

	/**
	 *
	 */
	go_content_stats.change_state = function ( period ) {
		this.period = period || this.get_period();
		this.context = this.get_context();
		this.prep_stats();
	};

	go_content_stats.get_range = function() {
		var days = [];

		var current = this.period.start.split( '-' );
		var end = this.period.end.split( '-' );

		current = new Date( current );
		end = new Date( end );

		while ( current <= end ) {
			days.push( this.format_date( current ) );
			current = new Date( current.setDate( current.getDate() + 1 ) );
		}//end while

		return days;
	};

	/**
	 * format a date into YYYY-MM-DD
	 */
	go_content_stats.format_date = function( date ) {
		var dd = date.getDate();

		// January is 0
		var mm = date.getMonth() + 1;

		var yyyy = date.getFullYear();

		dd = dd < 10 ? '0' + dd : dd;
		mm = mm < 10 ? '0' + mm : mm;

		return yyyy + '-' + mm + '-' + dd;
	};

	go_content_stats.load_stats = function() {
		var day;

		// clear the day stats object so we start fresh
		this.day_stats = {};

		var context = this.get_context();
		var days = this.get_range();

		for ( var i in days ) {
			day = this.store.get( days[ i ], context );

			this.day_stats[ days[ i ] ] = day;
		}//end for

		this.build_stats();

		this.build_summary();
	};

	go_content_stats.build_stats = function( day_stats ) {
		var item;
		var date;

		// clear the stats object so we start fresh
		this.stats = {};

		if ( 'day' === this.get_zoom() ) {
			for ( date in this.day_stats ) {
				this.stats[ date ] = this.day_stats[ date ];
				this.stats[ date ].item = date;
			}// end for
		}// end if
		else {
			for ( date in this.day_stats ) {
				if ( 'week' == this.get_zoom() ) {
					item = 'Week ' + moment( date, 'YYYY-MM-DD' ).format( 'W, GGGG' );
				}//end if
				else if ( 'month' == this.get_zoom() ) {
					item = moment( date, 'YYYY-MM-DD' ).format( 'MMMM YY' );
				}//end if
				else if ( 'quarter' == this.get_zoom() ) {
					item = moment( date, 'YYYY-MM-DD' ).fquarter( 1 ).toString();
				}//end if

				if ( 'undefined' == typeof this.stats[ item ] ) {
					this.stats[ item ] = {
						item: item,
						posts: 0,
						comments: 0,
						match_pro: 0,
						match_events: 0,
						pvs: null
					};
				}// end if

				this.stats[ item ].posts += this.day_stats[ date ].posts;
				this.stats[ item ].comments += this.day_stats[ date ].comments;

				// @TODO: these need to be done conditionally, or dynamically, or something...
				this.stats[ item ].match_pro += this.day_stats[ date ].match_pro;
				this.stats[ item ].match_events += this.day_stats[ date ].match_events;
			}// end for
		} // end else
	};

	go_content_stats.build_summary = function() {
		this.summary = {
			'items': 0,
			'posts': 0,
			'pvs': 0,
			'comments': 0,
		};

		for ( var i in this.stats ) {
			this.summary.items++;
			this.summary.posts += this.stats[ i ].posts;
			this.summary.pvs += this.stats[ i ].pvs;
			this.summary.comments += this.stats[ i ].comments;
		}//end for
	};

	/**
	 * loads stats and dumps them onto the page
	 *
	 * NOTE: we are using $.proxy when handling the promise objects so the callback's
	 *       context will be go_content_stats
	 */
	go_content_stats.prep_stats = function () {
		this.load_stats();
		this.fill_gaps();
		this.mind_the_gap( { stats: [], which: 'general' } );
		this.mind_the_gap( { stats: [], which: 'pvs' } );
	};

	go_content_stats.fill_gaps = function() {
		var days = this.get_range();
		var day;

		for ( var i in days ) {
			day = this.day_stats[ days[ i ] ];

			if ( null === day ) {
				this.gaps.general[ i ] = days[ i ];
			}//end if

			if (
				day
				&& (
					'undefined' == typeof day.pvs
					|| null === day.pvs
				)
			) {
				this.gaps.pvs[ i ] = days[ i ];
			}//end if
		}//end for

		console.log( this.gaps );

		this.$stat_data.block( this.blockui_args );
		this.$taxonomy_data.block( this.blockui_args );

		this.fetch_in_chunks( 'general', this.gaps.general.slice( 0 ) );
		this.fetch_in_chunks( 'pvs', this.gaps.pvs.slice( 0 ) );

		var taxonomies_promise = this.fetch_stats( 'taxonomies', {
			days: this.get_range()
		} );

		// when the taxonomy data has come back, render it
		taxonomies_promise.done( $.proxy( function( response ) {
			this.receive( response );
		}, this ) );
	};

	go_content_stats.fetch_in_chunks = function( which, gaps ) {
		while ( gaps.length > 0 ) {
			var args = {
				days: []
			};

			while ( args.days.length < 50 && gaps.length > 0 ) {
				args.days.push( gaps.shift() );
			}//end for

			var promise = this.fetch_stats( which, args );

			// when the general stats have come back, render them and then fire off
			// a request for page view (pv) stats
			promise.done( $.proxy( function( response ) {
				this.receive( response, args );
			}, this ) );
		}//end while
	};

	go_content_stats.receive = function( response, args ) {
		if ( ! response.success ) {
			console.warn( 'bad response: ' + response.data );
			return;
		}// end if

		console.info( 'receive: ' + response.data.which );
		console.dir( response.data );

		if ( response.data.period.period !== this.period.period ) {
			return;
		}//end if

		var context = this.get_context();
		if ( response.data.type !== context.type && response.data.key !== context.key ) {
			return;
		}//end if

		go_content_stats[ 'receive_' + response.data.which ]( response, args );
	};

	/**
	 * receive general stats
	 *
	 * @param  object response the response from the request
	 * @return null
	 */
	go_content_stats.receive_general = function( response, args ) {
		var context = this.get_context();
		this.store.insert( response.data, context );

		// when the pv stats have come back, render them
		var pv_promise = this.fetch_stats( 'pvs', args );

		pv_promise.done( $.proxy( function( response ) {
			this.receive( response );
		}, this ) );
	};

	/**
	 * receive page view data to supplement general stats
	 *
	 * @param  object response the response from the request
	 * @return null
	 */
	go_content_stats.receive_pvs = function( response ) {
		var context = this.get_context();
		this.store.update( response.data, context );
	};

	/**
	 * receive list of taxonomies for displaying criteria
	 *
	 * @param  object response the response from the request
	 * @return null
	 */
	go_content_stats.receive_taxonomies = function( response ) {
		this.render_taxonomies( response.data );
	};

	/**
	 * receive list of posts for displaying criteria
	 *
	 * @param  object response the response from the request
	 * @return null
	 */
	go_content_stats.receive_posts = function( response ) {
		this.render_posts( response.data );
	};

	/**
	 * gets the currently selected period and parses it into a start and end value
	 */
	go_content_stats.get_period = function () {
		return {
			start: this.$start.val(),
			end: this.$end.val()
		};
	};

	/**
	 * gets the current selected context
	 */
	go_content_stats.get_context = function () {
		if ( 'undefined' === typeof this.context ) {
			return {
				type: $( '#go-content-stats-type' ).val(),
				key: $( '#go-content-stats-key' ).val()
			};
		}// end if

		return this.context;
	};

	/**
	 * gets the current selected context
	 */
	go_content_stats.get_zoom = function () {
		var $zoom = this.$zoom_levels.find( '.active' );

		if ( ! $zoom.length ) {
			return 'day';
		}//end if

		return $zoom.data( 'zoom-level' );
	};

	/**
	 * fetches stats from the endpoint
	 *
	 * @param string which stats to retrieve from the endpoint (general|pvs|taxonomies)
	 * @return jqXHR
	 */
	go_content_stats.fetch_stats = function ( which, args ) {
		var period = this.get_period();
		var context = this.get_context();

		var defaults = {
			date_start: period.start,
			date_end: period.end,
			which: which,
			type: context.type,
			key: context.key,
			days: []
		};

		args = $.extend( defaults, args );

		console.info( 'fetch: ' + which );
		console.dir( args );

		return $.getJSON( this.endpoint, args );
	};

	go_content_stats.fetch_posts = function ( $row ) {
		// @TODO: this will need to change when we are doing more than a single day per row
		var post_date = $row.attr( 'id' ).replace( 'row-', '' );
		var args = {
			days: [ post_date ]
		};

		var posts_promise = this.fetch_stats( 'posts', args );

		posts_promise.done( $.proxy( function( response ) {
			this.receive( response );
		}, this ) );
	};

	/**
	 * renders the general stats via a Handlebars template
	 */
	go_content_stats.render_general_stats = function () {
		this.load_stats();

		// z: using handlebars: http://handlebarsjs.com/
		var source = $( '#stat-row-template' ).html();
		var template = Handlebars.compile( source );

		var template_data = {
			stats: this.stats,
			summary: this.summary
		};

		$( '#stat-data' ).html( template( template_data ) );

		this.render_summary();
	};

	/**
	 * render the pv stats on the stats that have already been populated via
	 * the this.render_general_stats function
	 */
	go_content_stats.render_pvs_stats = function () {
		this.load_stats();

		var num_posts = 0;
		var pvs = 0;

		// populate the pvs columns in the stat rows
		// @TODO: handle zoom levels for pv stats, will need to summarize these by zoom level
		for ( var i in this.stats ) {
			if ( null === this.stats[ i ].pvs ) {
				continue;
			}//end if

			var $row = $( '#row-' + i );

			num_posts = parseInt( $row.data( 'num-posts' ), 10 );
			pvs = parseInt( this.stats[ i ].pvs, 10 );

			this.summary.pvs += pvs;

			$row.find( '.pvs' ).html( this.number_format( pvs ) );
			$row.find( '.pvs' ).data( 'num-pvs', pvs );
			$row.find( '.pvs-per-post' ).html( this.number_format( pvs / num_posts ) );
		}//end for

		this.render_summary();
	};

	/**
	 * calculate and render summary data
	 */
	go_content_stats.render_summary = function() {
		var $summary = $( '.stat-summary' );

		$summary.find( '.pvs' ).html( this.number_format( this.summary.pvs ) );

		if ( ! this.summary.posts ) {
			$summary.find( '.comments-per-post' ).html( 0 );
			$summary.find( '.pvs-per-post' ).html( 0 );
			return;
		}//end if

		$summary.find( '.comments-per-post' ).html( this.number_format( this.summary.comments / this.summary.posts ) );

		if ( this.summary.pvs ) {
			$summary.find( '.pvs-per-post' ).html( this.number_format( this.summary.pvs / this.summary.posts ) );
		} else {
			$summary.find( '.pvs-per-post' ).html( 0 );
		}//end else

		this.graph.render_top_graph();
	};

	/**
	 * renders the post data via a Handlebars template
	 */
	go_content_stats.render_posts = function ( data ) {
		var source = $( '#post-row-template' ).html();
		var template = Handlebars.compile( source );

		var $row = $( '#row-' + data.period.start );
		$row.find( '.posts i' ).attr( 'class', '' ).addClass( 'fa fa-angle-up' );
		$next = $row.next();
		$next.find( 'td' ).html( template( data ) );
		$next.removeClass( 'loading' ).addClass( 'loaded' );

		console.log('render!');
		// @TODO: figure out how/where to append
		//$( '#taxonomy-data' ).html( template( data ) );
	};

	/**
	 * renders the taxonomy data via a Handlebars template
	 */
	go_content_stats.render_taxonomies = function ( data ) {
		var source = $( '#taxonomy-criteria-template' ).html();
		var template = Handlebars.compile( source );

		$( '#taxonomy-data' ).html( template( data ) );
	};

	/**
	 * output number with commas
	 */
	go_content_stats.number_format = function( num ) {
		if ( ! num || 'undefined' == typeof num ) {
			return 0;
		}//end if

		// round to 1 decimal
		num = parseFloat( parseInt( num, 10 ).toFixed( 2 ), 10 );

		return num.toString().replace( /\B(?=(\d{3})+(?!\d))/g, ',' );
	};

	go_content_stats.mind_the_gap = function( data ) {
		for ( var i in data.stats ) {
			var index = this.gaps[ data.which ].indexOf( i );

			if ( -1 !== index ) {
				this.gaps[ data.which ].splice( index, 1 );
			}//end if
		}//end for

		if ( this.gaps[ data.which ].length > 0 ) {
			return;
		}//end if

		// we only want to render the pvs data if the general data has all been loaded
		if ( 'pvs' == data.which && this.gaps.general.length > 0 ) {
			return;
		}//end if

		this[ 'render_' + data.which + '_stats' ]();
	};

	go_content_stats.event.mind_the_gap = function( e, data ) {
		go_content_stats.mind_the_gap( data );
	};

	/**
	 * handle the selection of new criteria
	 */
	go_content_stats.event.select_criteria = function ( e ) {
		e.preventDefault();

		var criteria = {
			type: $( this ).data( 'type' ),
			type_pretty: $( this ).data( 'type' ).replace( '_', ' ' ),
			key: $( this ).data( 'key' ),
			name: $( this ).html()
		};

		go_content_stats.select_criteria( criteria );
	};

	/**
	 * handle the removal of criteria
	 */
	go_content_stats.event.remove_criteria = function ( e ) {
		go_content_stats.remove_criteria();
	};

	/**
	 * handle the state change
	 */
	go_content_stats.event.change_state = function ( e ) {
		e.preventDefault();

		if ( 'undefined' != typeof e.originalEvent.state.start ){
			go_content_stats.change_state( e.originalEvent.state );
		}
	};

	go_content_stats.event.fetch_posts = function ( e ) {
		e.preventDefault();

		var $row = $( this ).closest( '.stat-row' );
		var $icon = $row.find( '.posts i' );

		var $next = $row.next();
		if ( $next.is( '.loaded' ) ) {
			if ( $next.is( ':visible' ) ) {
				$icon.attr( 'class', '' ).addClass( 'fa fa-angle-down' );
				$next.hide();
			}// end if
			else {
				$icon.attr( 'class', '' ).addClass( 'fa fa-angle-up' );
				$next.show();
			}// end if
		}// end if
		else {
			$icon.attr( 'class', '' ).addClass( 'fa fa-spinner fa-spin' );
			if ( $next.is( 'loading' ) ) {
				return;
			}// end if

			go_content_stats.fetch_posts( $row );
			$next.addClass( 'loading' );
		}// end else
	};

	/**
	 * handles clearing local storage cache
	 *
	 * @return null
	 */
	go_content_stats.event.clear_cache = function( e ) {
		e.preventDefault();
		go_content_stats.store.clear();
		go_content_stats.push_state();
	};

	/**
	 * handles the zoom level selection event
	 */
	go_content_stats.event.select_zoom = function( e ) {
		go_content_stats.select_zoom( $( this ).data( 'zoom-level' ) );
	};

	/**
	 * clear go-content-stats entries from local storage
	 *
	 * @return null
	 */
	go_content_stats.store.clear = function() {
		for ( var i in localStorage ) {
			if ( i.match( /^go-content-stats-/ ) ) {
				localStorage.removeItem( i );
			}//end if
		}//end for
	};

	/**
	 * insert multiple dates into the store
	 *
	 * @param  array data data elements to insert, indexed by date
	 * @param  object context includes 'type' and optionally 'key'
	 * @return null
	 */
	go_content_stats.store.insert = function ( data, context ) {
		for ( var i in data.stats ) {
			data.stats[ i ].inserted_timestamp = new Date().getTime();
			this.set( i, context, data.stats[ i ] );
		}

		$( document ).trigger( 'go-content-stats-insert', data );
	};

	/**
	 * update multiple dates data in the store
	 *
	 * @param  array data the data elements to update, indexed by date
	 * @param  object context includes 'type' and optionally 'key'
	 * @return null
	 */
	go_content_stats.store.update = function ( data, context ) {
		var record;
		for ( var i in data.stats ) {
			record = this.get( i, context );
			$.extend( record, data.stats[ i ] );
			this.set( i, context, record );
		}

		$( document ).trigger( 'go-content-stats-update', data );
	};

	/**
	 * get stats for an index
	 *
	 * @param  string index the index to fetch, ex. 2014-12-23
	 * @param  object context includes 'type' and optionally 'key'
	 * @return object the stats for the index
	 */
	go_content_stats.store.get = function ( index, context ) {
		var record = JSON.parse( localStorage.getItem( this.key( index, context ) ) );
		var now = new Date().getTime();

		if ( ! record ) {
			return null;
		}//end if

		if ( record.inserted_timestamp + this.ttl < now ) {
			this.delete( index, context );
			return null;
		}//end if

		return record;
	};

	/**
	 * set stats for an index
	 *
	 * @param string index the index to set, ex. 2014-12-23
	 * @param  object context includes 'type' and optionally 'key'
	 * @param object stats the stats for the index
	 * @return null
	 */
	go_content_stats.store.set = function ( index, context, stats ) {
		localStorage.setItem( this.key( index, context ), JSON.stringify( stats ) );
	};

	/**
	 * delete stats for an index
	 *
	 * @param string index the index to delete, ex. 2014-12-23
	 * @param  object context includes 'type' and optionally 'key'
	 * @return null
	 */
	go_content_stats.store.delete = function ( index, context ) {
		localStorage.removeItem( this.key( index, context ) );
	};

	/**
	 * get a key string for a given index and context
	 * @param  string  index    the index
	 * @param  object  context  includes 'type' and optionally 'key'
	 * @return string           the key
	 */
	go_content_stats.store.key = function ( index, context ) {
		var context_key = context.type;

		if ( 'general' !== context.type ) {
			context_key += '-' + context.key;
		}// end if

		return 'go-content-stats-' + context_key + '-' + index;
	};
} )( jQuery );
