import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoicnlsaW5kYmVyZyIsImEiOiJjbWFvdmRpZmYwYXk0MmpwdmFwMGZpMDV3In0.VrRnvdrlPei8e7UC7lNm_Q';

// Global variables for data and visualization elements
let stations = [];
let trips = [];
let circles;
let radiusScale;
let timeFilter = -1;
let timeSlider, selectedTime, anyTimeLabel;

// Helper functions
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes); // Set hours & minutes
    return date.toLocaleString('en-US', { timeStyle: 'short' }); // Format as HH:MM AM/PM
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function computeStationTraffic(stations, trips) {
    // Compute departures
    const departures = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.start_station_id,
    );

    // Compute arrivals
    const arrivals = d3.rollup(
        trips,
        (v) => v.length,
        (d) => d.end_station_id,
    );

    return stations.map((station) => {
        let id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips // If no filter is applied (-1), return all trips
        : trips.filter((trip) => {
            // Convert trip start and end times to minutes since midnight
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);

            // Include trips that started or ended within 60 minutes of the selected time
            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

function updateScatterPlot(timeFilter) {
    if (!circles || !trips || !stations || !radiusScale) {
        console.log("Not ready to update scatter plot yet");
        return;
    }
    
    // Get only the trips that match the selected time filter
    const filteredTrips = filterTripsbyTime(trips, timeFilter);
    console.log("Filtered trips: ", filteredTrips.length);

    // Recompute station traffic based on the filtered trips
    const filteredStations = computeStationTraffic(stations, filteredTrips);
    console.log("Updated stations for filtering: ", filteredStations.length);

    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    // Update the scatterplot by adjusting the radius of circles
    circles
        .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
        .join('circle') // Ensure the data is bound correctly
        .attr('r', (d) => radiusScale(d.totalTraffic)); // Update circle sizes
}

function updateTimeDisplay() {
    if (!timeSlider) {
        console.log("Time slider not initialized yet");
        return;
    }
    
    timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    // Call updateScatterPlot to reflect the changes on the map
    updateScatterPlot(timeFilter);
}

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map', // ID of the div where the map will render
    style: 'mapbox://styles/mapbox/streets-v12', // Map style
    center: [-71.09415, 42.36027], // [longitude, latitude]
    zoom: 12, // Initial zoom level
    minZoom: 5, // Minimum allowed zoom
    maxZoom: 18, // Maximum allowed zoom
});

// define layer style
const style = {
    'line-color': '#32D400',
    'line-width': 3,
    'line-opacity': 0.5
}

// Initialize DOM elements
function initDomElements() {
    // Get references to slider and time display elements
    timeSlider = document.getElementById('time-slider');
    selectedTime = document.getElementById('selected-time');
    anyTimeLabel = document.getElementById('any-time-label');

    // Initialize time display to match initial slider value
    if (timeSlider.value === "-1") {
        selectedTime.style.display = 'none';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.style.display = 'block';
        anyTimeLabel.style.display = 'none';
    }

    // Update time display when slider changes
    timeSlider.addEventListener('input', () => {
        const value = parseInt(timeSlider.value);

        if (value === -1) {
            selectedTime.style.display = 'none';
            anyTimeLabel.style.display = 'block';
        } else {
            selectedTime.textContent = formatTime(value);
            selectedTime.style.display = 'block';
            anyTimeLabel.style.display = 'none';
        }

        updateTimeDisplay();
    });
}

// Call this when document is ready
document.addEventListener('DOMContentLoaded', initDomElements);

// load data layers
map.on('load', async () => {
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: style
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });

    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: style
    });

    let jsonData;
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

        // Await JSON fetch
        jsonData = await d3.json(jsonurl);

        console.log('Loaded JSON Data:', jsonData); // Log to verify structure
    } catch (error) {
        console.error('Error loading JSON:', error); // Handle errors
    }

    try {
        // Load trips with date parsing
        trips = await d3.csv(
            'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
            (trip) => {
                trip.started_at = new Date(trip.started_at);
                trip.ended_at = new Date(trip.ended_at);
                return trip;
            }
        );
        console.log("Loaded trips: ", trips.length);
    } catch (error) {
        console.error('Error loading trips data:', error);
    }

    // Process stations with traffic data
    stations = computeStationTraffic(jsonData.data.stations, trips);
    console.log('Stations Array:', stations);

    // Select existing SVG element from the DOM
    const svg = d3.select('#map').select('svg')

    function getCoords(station) {
        const point = new mapboxgl.LngLat(+station.lon, +station.lat); // Convert lon/lat to Mapbox LngLat
        const { x, y } = map.project(point); // Project to pixel coordinates
        return { cx: x, cy: y }; // Return as object for use in SVG attributes
    }

    // Append circles to the SVG for each station
    circles = svg
        .selectAll('circle')
        .data(stations, (d) => d.short_name)
        .enter()
        .append('circle')
        .attr('r', 5) // Radius of the circle
        .attr('fill', 'steelblue') // Circle fill color
        .attr('stroke', 'white') // Circle border color
        .attr('stroke-width', 1) // Circle border thickness
        .attr('opacity', 0.8)
        .style('pointer-events', 'auto'); // Make circles interactive

    // Function to update circle positions when the map moves/zooms
    function updatePositions() {
        circles
            .attr('cx', (d) => getCoords(d).cx) // Set the x-position using projected coordinates
            .attr('cy', (d) => getCoords(d).cy); // Set the y-position using projected coordinates
    }

    // Initial position update when map loads
    updatePositions();

    // Reposition markers on map interactions
    map.on('move', updatePositions); // Update during map movement
    map.on('zoom', updatePositions); // Update during zooming
    map.on('resize', updatePositions); // Update on window resize
    map.on('moveend', updatePositions); // Final adjustment after movement ends

    radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (d) => d.totalTraffic)])
        .range([3, 20]);

    // Update the radius of existing circles
    circles.attr('r', (d) => {
        const radius = radiusScale(d.totalTraffic);
        return radius;
    });

    // Make sure positions are correct after radius update
    updatePositions();

    // Add tooltips directly to the existing circles
    circles.each(function (d) {
        // Add <title> for browser tooltips
        d3.select(this)
            .append('title')
            .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
    });

    // Also initialize the DOM elements if they aren't already
    if (!timeSlider) {
        initDomElements();
    }

    // Initialize the time slider and display after everything is loaded
    if (timeSlider) {
        updateTimeDisplay();
    }
});


