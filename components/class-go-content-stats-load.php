<?php

class GO_Content_Stats_Load
{
	private $google_analytics;
	public $output_directory = NULL;

	public function load_range( $start, $end )
	{
		$profiles = go_content_stats()->config( 'google_profiles' );
		$date = $start;
		$data = array();
		while ( strtotime( $date ) <= strtotime( $end ) )
		{
			foreach ( $profiles as $property => $profile_id )
			{
				$data = $this->generate_day( $date, $profile_id );

				$this->populate_stats( $date, $data, $property );
			}//end foreach

			unset( $data );
			$date = date( 'Y-m-d', strtotime( '+1 day', strtotime( $date ) ) );
		}//end while
	}// end load_range

	private function google_analytics()
	{
		if ( ! $this->google_analytics )
		{
			$this->google_analytics = go_google( go_content_stats()->config( 'application_name' ), go_content_stats()->config( 'google_auth_account' ), go_content_stats()->config( 'key_file' ) )->analytics();
		}// end if

		return $this->google_analytics;
	}//end google_analytics

	private function generate_day( $date, $profile_id )
	{
		if ( $this->output_directory )
		{
			$filename = "$this->output_directory/$profile_id-$date.json";

			if ( file_exists( $filename ) )
			{
				$tmp = file_get_contents( $filename );
				$tmp = json_decode( $tmp );
				return $tmp;
			}// end if
		}// end if

		$data = $this->get_analytics( $date, $profile_id );

		$message = $date . ' (fetch): ' . count( $data );

		if ( defined( 'WP_CLI' ) && WP_CLI )
		{
			WP_CLI::line( $message );
		}//end if
		else
		{
			fwrite( STDOUT, "{$message}\n" );
		}//end else

		if ( $this->output_directory )
		{
			file_put_contents( $filename, json_encode( $data ) );
		}// end if

		return $data;
	}// end generate_day

	private function get_analytics( $date, $profile_id, $index = FALSE )
	{
		$full_data = array();

		$args = array(
			'max-results' => 10000,
			'dimensions' => 'ga:pagePath,ga:hostname',
		);

		if ( $index )
		{
			$args[ 'start-index' ] = $index;
		}// end if

		$data = $this->google_analytics()->data_ga->get(
			'ga:' . $profile_id,
			$date,
			$date,
			'ga:pageviews',
			$args
		);

		$full_data = $data->rows;

		if ( ! empty( $data->nextLink ) )
		{
			preg_match( '/start-index=([0-9]+)/', $data->nextLink, $matches );
			$more_data = $this->get_analytics( $date, $profile_id, $matches[1] );
			$full_data = array_merge( $full_data, $more_data );
		}// end if

		return $full_data;
	}// end get_analytics

	private function populate_stats( $date, $data, $property )
	{
		if ( ! $data )
		{
			return;
		}//end if

		$message = $date . ' (insert): ' . count( $data );
		if ( defined( 'WP_CLI' ) && WP_CLI )
		{
			WP_CLI::line( $message );
		}//end if
		else
		{
			fwrite( STDOUT, "{$message}\n" );
		}//end else

		go_content_stats()->storage()->delete( array( 'date' => $date ) );

		foreach ( $data as $row )
		{
			$stat_row = array(
				'date' => $date,
				'property' => $property,
				// this needs to remain http because that matches the guid
				'url' => 'http://' .  $row[1] . $row[0],
				'views' => $row[2],
			);
			go_content_stats()->storage()->insert( $stat_row );
		}// end foreach
	}// end populate_stats
}// end GO_Content_Stats_Load
