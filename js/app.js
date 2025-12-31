/**
 * ZHVI Map Application
 * Main application logic with true lazy loading
 * 
 * Data is only loaded when needed:
 * - CSV data: Loaded once on init (required for all operations)
 * - GeoJSON: Only loaded when a state is selected
 * - National ranges: Calculated once from CSV data
 */

// Application state
const AppState = {
    map: null,
    currentLayer: null,
    currentGeoJSON: null,  // Cache current state's GeoJSON
    zhviData: {},          // Price data by ZIP code
    currentYear: 2000,
    currentState: null,
    isPlaying: false,
    playInterval: null,
    priceRange: { min: 0, max: 1000000 },
    scaleMode: 'state',    // 'state' or 'national'
    nationalPriceRange: {}, // National ranges per year (calculated once)
    isDataLoaded: false    // Track if CSV is loaded
};

// DOM element cache
const Elements = {};

/**
 * Initialize DOM element references
 */
function cacheElements() {
    Elements.stateSelect = document.getElementById('stateSelect');
    Elements.yearSlider = document.getElementById('yearSlider');
    Elements.currentYear = document.getElementById('currentYear');
    Elements.playBtn = document.getElementById('playBtn');
    Elements.playIcon = document.getElementById('playIcon');
    Elements.playText = document.getElementById('playText');
    Elements.statsBar = document.getElementById('statsBar');
    Elements.statMedian = document.getElementById('statMedian');
    Elements.statMin = document.getElementById('statMin');
    Elements.statMax = document.getElementById('statMax');
    Elements.legendScale = document.getElementById('legendScale');
    Elements.legendMin = document.getElementById('legendMin');
    Elements.legendMax = document.getElementById('legendMax');
    Elements.infoPanel = document.getElementById('infoPanel');
    Elements.infoZip = document.getElementById('infoZip');
    Elements.infoPrice = document.getElementById('infoPrice');
    Elements.infoChange = document.getElementById('infoChange');
    Elements.loadingOverlay = document.getElementById('loadingOverlay');
    Elements.zipSearch = document.getElementById('zipSearch');
    Elements.searchBtn = document.getElementById('searchBtn');
    Elements.searchError = document.getElementById('searchError');
    Elements.controlPanel = document.getElementById('controlPanel');
    Elements.mobileToggle = document.getElementById('mobileToggle');
    Elements.scaleState = document.getElementById('scaleState');
    Elements.scaleNational = document.getElementById('scaleNational');
}

/**
 * Initialize the Leaflet map
 */
function initMap() {
    AppState.map = L.map('map', {
        center: [39.8, -98.5],
        zoom: 4,
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true  // Canvas renderer for better performance
    });

    // Dark map tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(AppState.map);

    buildLegend();
}

/**
 * Build the color legend gradient
 */
function buildLegend() {
    Elements.legendScale.innerHTML = COLORS.map(color => 
        `<div style="flex:1;background:${color}"></div>`
    ).join('');
}

/**
 * Populate the state dropdown
 */
function populateStateDropdown() {
    const sortedStates = Object.entries(STATES)
        .sort((a, b) => a[1].name.localeCompare(b[1].name));
    
    sortedStates.forEach(([abbr, state]) => {
        const option = document.createElement('option');
        option.value = abbr;
        option.textContent = state.name;
        Elements.stateSelect.appendChild(option);
    });
}

/**
 * Show or hide the loading overlay
 * @param {boolean} show - Whether to show the overlay
 * @param {string} text - Optional loading text
 */
function showLoading(show, text = 'Loading...') {
    const loadingText = Elements.loadingOverlay.querySelector('.loading-text');
    if (loadingText) loadingText.textContent = text;
    
    if (show) {
        Elements.loadingOverlay.classList.add('visible');
    } else {
        Elements.loadingOverlay.classList.remove('visible');
    }
}

/**
 * Load the ZHVI CSV data
 * This is loaded once on initialization
 */
async function loadZHVIData() {
    return new Promise((resolve, reject) => {
        Papa.parse('ZHVI_WI.csv', {
            download: true,
            header: true,
            complete: (results) => {
                results.data.forEach(row => {
                    if (row.Zip_Code) {
                        const zip = row.Zip_Code.toString().padStart(5, '0');
                        AppState.zhviData[zip] = row;
                    }
                });
                
                AppState.isDataLoaded = true;
                console.log(`Loaded ${Object.keys(AppState.zhviData).length} ZIP codes with price data`);
                
                // Calculate national price ranges (once)
                calculateNationalPriceRanges();
                
                resolve();
            },
            error: (err) => reject(err)
        });
    });
}

/**
 * Calculate national price ranges for all years
 * This is done once after CSV load for the national scale feature
 */
function calculateNationalPriceRanges() {
    for (let year = 2000; year <= 2025; year++) {
        const prices = [];
        
        Object.values(AppState.zhviData).forEach(data => {
            if (data[year]) {
                const price = parseFloat(data[year]);
                if (!isNaN(price) && price > 0) {
                    prices.push(price);
                }
            }
        });

        if (prices.length > 0) {
            prices.sort((a, b) => a - b);
            const p5 = prices[Math.floor(prices.length * 0.05)];
            const p95 = prices[Math.floor(prices.length * 0.95)];
            
            AppState.nationalPriceRange[year] = { min: p5, max: p95 };
        } else {
            AppState.nationalPriceRange[year] = { min: 50000, max: 1000000 };
        }
    }
    console.log('National price ranges calculated');
}

/**
 * Load GeoJSON for a specific state (lazy loaded)
 * @param {string} stateAbbr - State abbreviation
 * @returns {Promise<Object|null>} GeoJSON data or null
 */
async function loadStateGeoJSON(stateAbbr) {
    const state = STATES[stateAbbr];
    if (!state) return null;

    showLoading(true, `Loading ${state.name}...`);
    
    try {
        const response = await fetch(`geojsons/${state.file}`);
        const geojson = await response.json();
        console.log(`Loaded ${geojson.features.length} ZIP boundaries for ${state.name}`);
        return geojson;
    } catch (err) {
        console.error('Failed to load GeoJSON:', err);
        return null;
    } finally {
        showLoading(false);
    }
}

/**
 * Get color based on price value
 * @param {number} price - Home price value
 * @returns {string} Hex color code
 */
function getColor(price) {
    if (!price || price === 0) return '#6b7280'; // Light gray for no data
    
    const { min, max } = AppState.priceRange;
    const normalized = (price - min) / (max - min);
    const index = Math.min(Math.floor(normalized * COLORS.length), COLORS.length - 1);
    return COLORS[Math.max(0, index)];
}

/**
 * Format a number as currency
 * @param {number} value - Value to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(value) {
    if (!value) return 'N/A';
    if (value >= 1000000) {
        return '$' + (value / 1000000).toFixed(2) + 'M';
    } else if (value >= 1000) {
        return '$' + (value / 1000).toFixed(0) + 'K';
    }
    return '$' + value.toLocaleString();
}

/**
 * Calculate price range statistics for a GeoJSON dataset
 * @param {Object} geojson - GeoJSON data
 * @returns {Object} Price range statistics
 */
function calculatePriceRange(geojson) {
    const prices = [];
    
    geojson.features.forEach(feature => {
        const zip = feature.properties.ZCTA5CE10;
        const data = AppState.zhviData[zip];
        if (data && data[AppState.currentYear]) {
            const price = parseFloat(data[AppState.currentYear]);
            if (!isNaN(price) && price > 0) {
                prices.push(price);
            }
        }
    });

    if (prices.length === 0) {
        return { min: 0, max: 1000000, median: 0, lowest: 0, highest: 0, count: 0 };
    }

    prices.sort((a, b) => a - b);
    
    return {
        min: prices[Math.floor(prices.length * 0.05)],
        max: prices[Math.floor(prices.length * 0.95)],
        median: prices[Math.floor(prices.length * 0.5)],
        lowest: prices[0],
        highest: prices[prices.length - 1],
        count: prices.length
    };
}

/**
 * Style function for GeoJSON features
 * @param {Object} feature - GeoJSON feature
 * @returns {Object} Leaflet style object
 */
function styleFeature(feature) {
    const zip = feature.properties.ZCTA5CE10;
    const data = AppState.zhviData[zip];
    let price = 0;
    
    if (data && data[AppState.currentYear]) {
        price = parseFloat(data[AppState.currentYear]) || 0;
    }

    return {
        fillColor: getColor(price),
        weight: 1,
        opacity: 0.6,
        color: '#1a1a2e',
        fillOpacity: 0.4,
        lineCap: 'round',
        lineJoin: 'round'
    };
}

/**
 * Handle feature hover/click events
 * @param {Object} feature - GeoJSON feature
 * @param {Object} layer - Leaflet layer
 */
function onEachFeature(feature, layer) {
    layer.on({
        mouseover: (e) => highlightFeature(e, feature),
        mouseout: resetHighlight,
        click: (e) => zoomToFeature(e)
    });
}

/**
 * Highlight a feature on hover
 * @param {Object} e - Leaflet event
 * @param {Object} feature - GeoJSON feature
 */
function highlightFeature(e, feature) {
    const layer = e.target;
    
    layer.setStyle({
        weight: 2.5,
        color: '#ffffff',
        fillOpacity: 1,
        lineCap: 'round',
        lineJoin: 'round'
    });

    layer.bringToFront();

    // Update info panel
    const zip = feature.properties.ZCTA5CE10;
    const data = AppState.zhviData[zip];

    if (data) {
        const currentPrice = parseFloat(data[AppState.currentYear]) || 0;
        const basePrice = parseFloat(data['2000']) || 0;
        
        Elements.infoZip.textContent = `ZIP Code: ${zip}`;
        Elements.infoPrice.textContent = formatCurrency(currentPrice);
        
        if (basePrice > 0 && currentPrice > 0) {
            const change = ((currentPrice - basePrice) / basePrice * 100).toFixed(1);
            const isPositive = change >= 0;
            Elements.infoChange.textContent = `${isPositive ? '+' : ''}${change}% since 2000`;
            Elements.infoChange.className = `info-change ${isPositive ? 'positive' : 'negative'}`;
        } else {
            Elements.infoChange.textContent = 'No historical data';
            Elements.infoChange.className = 'info-change';
        }
    } else {
        Elements.infoZip.textContent = `ZIP Code: ${zip}`;
        Elements.infoPrice.textContent = 'No data';
        Elements.infoChange.textContent = '';
        Elements.infoChange.className = 'info-change';
    }

    Elements.infoPanel.classList.add('visible');
}

/**
 * Reset feature highlight
 * @param {Object} e - Leaflet event
 */
function resetHighlight(e) {
    if (AppState.currentLayer) {
        AppState.currentLayer.resetStyle(e.target);
    }
    Elements.infoPanel.classList.remove('visible');
}

/**
 * Zoom to a feature on click
 * @param {Object} e - Leaflet event
 */
function zoomToFeature(e) {
    AppState.map.fitBounds(e.target.getBounds(), { padding: [50, 50] });
}

/**
 * Apply price range based on current scale mode
 * @param {Object} stateRange - State-level price range
 */
function applyPriceRange(stateRange) {
    if (AppState.scaleMode === 'national' && AppState.nationalPriceRange[AppState.currentYear]) {
        AppState.priceRange = { 
            min: AppState.nationalPriceRange[AppState.currentYear].min, 
            max: AppState.nationalPriceRange[AppState.currentYear].max 
        };
    } else {
        AppState.priceRange = { min: stateRange.min, max: stateRange.max };
    }

    // Update legend
    Elements.legendMin.textContent = formatCurrency(AppState.priceRange.min);
    Elements.legendMax.textContent = formatCurrency(AppState.priceRange.max);

    // Update stats
    updateStats(stateRange);
}

/**
 * Update statistics display
 * @param {Object} range - Price range statistics
 */
function updateStats(range) {
    Elements.statsBar.style.display = 'grid';
    Elements.statMedian.textContent = formatCurrency(range.median);
    Elements.statMin.textContent = formatCurrency(range.lowest);
    Elements.statMax.textContent = formatCurrency(range.highest);
}

/**
 * Render a state's data on the map (LAZY LOADING)
 * GeoJSON is only loaded when this function is called
 * @param {string} stateAbbr - State abbreviation
 */
async function renderState(stateAbbr) {
    if (!stateAbbr) return;

    AppState.currentState = stateAbbr;
    const state = STATES[stateAbbr];
    
    // Remove existing layer
    if (AppState.currentLayer) {
        AppState.map.removeLayer(AppState.currentLayer);
        AppState.currentLayer = null;
    }

    // LAZY LOAD: Only fetch GeoJSON when state is selected
    const geojson = await loadStateGeoJSON(stateAbbr);
    if (!geojson) return;

    // Cache the GeoJSON for year updates
    AppState.currentGeoJSON = geojson;

    // Create layer
    AppState.currentLayer = L.geoJSON(geojson, {
        style: styleFeature,
        onEachFeature: onEachFeature
    });

    // Calculate and apply price range
    const stateRange = calculatePriceRange(geojson);
    applyPriceRange(stateRange);

    // Re-style with correct price range
    AppState.currentLayer.setStyle(styleFeature);
    
    // Add to map and zoom
    AppState.currentLayer.addTo(AppState.map);
    AppState.map.flyTo(state.center, state.zoom, { duration: 1 });
}

/**
 * Update the year and re-render current state
 * Uses cached GeoJSON - no additional network requests
 * @param {number|string} year - Year to display
 */
function updateYear(year) {
    AppState.currentYear = parseInt(year);
    Elements.currentYear.textContent = AppState.currentYear;
    Elements.yearSlider.value = AppState.currentYear;

    // Use cached GeoJSON - no need to fetch again
    if (AppState.currentLayer && AppState.currentGeoJSON) {
        const stateRange = calculatePriceRange(AppState.currentGeoJSON);
        applyPriceRange(stateRange);
        AppState.currentLayer.setStyle(styleFeature);
    }
}

/**
 * Set the scale mode (state or national)
 * Uses cached GeoJSON - no additional network requests
 * @param {string} mode - 'state' or 'national'
 */
function setScaleMode(mode) {
    AppState.scaleMode = mode;
    
    // Update toggle UI
    Elements.scaleState.classList.toggle('active', mode === 'state');
    Elements.scaleNational.classList.toggle('active', mode === 'national');

    // Use cached GeoJSON - no need to fetch again
    if (AppState.currentLayer && AppState.currentGeoJSON) {
        const stateRange = calculatePriceRange(AppState.currentGeoJSON);
        applyPriceRange(stateRange);
        AppState.currentLayer.setStyle(styleFeature);
    }
}

/**
 * Toggle timeline animation
 */
function togglePlay() {
    if (AppState.isPlaying) {
        // Stop
        clearInterval(AppState.playInterval);
        AppState.isPlaying = false;
        Elements.playBtn.classList.remove('playing');
        Elements.playIcon.innerHTML = '<path d="M8 5v14l11-7z"/>';
        Elements.playText.textContent = 'Play Timeline';
    } else {
        // Play
        AppState.isPlaying = true;
        Elements.playBtn.classList.add('playing');
        Elements.playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        Elements.playText.textContent = 'Pause';

        // Reset to 2000 if at end
        if (AppState.currentYear >= 2025) {
            updateYear(2000);
        }

        AppState.playInterval = setInterval(() => {
            if (AppState.currentYear >= 2025) {
                togglePlay(); // Stop at end
                return;
            }
            updateYear(AppState.currentYear + 1);
        }, 800);
    }
}

/**
 * Search for a ZIP code
 * @param {string} zip - 5-digit ZIP code
 */
async function searchZipCode(zip) {
    // Validate input
    if (!zip || zip.length !== 5) {
        Elements.searchError.textContent = 'Please enter a valid 5-digit ZIP code';
        Elements.searchError.className = 'search-error';
        return;
    }

    // Get the state for this ZIP
    const stateAbbr = getStateFromZip(zip);
    
    if (!stateAbbr || !STATES[stateAbbr]) {
        Elements.searchError.textContent = 'ZIP code not found in our database';
        Elements.searchError.className = 'search-error';
        return;
    }

    // Load the state if needed (lazy loading)
    if (AppState.currentState !== stateAbbr) {
        Elements.stateSelect.value = stateAbbr;
        await renderState(stateAbbr);
    }

    // Find and highlight the ZIP code polygon
    let found = false;
    AppState.currentLayer.eachLayer((layer) => {
        const layerZip = layer.feature.properties.ZCTA5CE10;
        if (layerZip === zip) {
            found = true;
            
            // Zoom to the feature
            AppState.map.fitBounds(layer.getBounds(), { padding: [100, 100], maxZoom: 12 });
            
            // Highlight it
            layer.setStyle({
                weight: 3,
                color: '#fbbf24',
                fillOpacity: 1
            });
            layer.bringToFront();

            // Show info
            const data = AppState.zhviData[zip];
            if (data) {
                const price = parseFloat(data[AppState.currentYear]) || 0;
                Elements.searchError.textContent = `Found! ${formatCurrency(price)} in ${AppState.currentYear}`;
                Elements.searchError.className = 'search-error success';
            } else {
                Elements.searchError.textContent = 'ZIP found but no price data available';
                Elements.searchError.className = 'search-error';
            }

            // Reset highlight after 3 seconds
            setTimeout(() => {
                if (AppState.currentLayer) {
                    AppState.currentLayer.resetStyle(layer);
                }
            }, 3000);
        }
    });

    if (!found) {
        Elements.searchError.textContent = 'ZIP code boundary not found in map data';
        Elements.searchError.className = 'search-error';
    }
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // State selection
    Elements.stateSelect.addEventListener('change', (e) => {
        renderState(e.target.value);
    });

    // Year slider
    Elements.yearSlider.addEventListener('input', (e) => {
        updateYear(e.target.value);
    });

    // Play button
    Elements.playBtn.addEventListener('click', togglePlay);

    // Scale toggle
    Elements.scaleState.addEventListener('click', () => setScaleMode('state'));
    Elements.scaleNational.addEventListener('click', () => setScaleMode('national'));

    // ZIP search - input validation
    Elements.zipSearch.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        Elements.searchError.textContent = '';
    });

    // ZIP search - button click
    Elements.searchBtn.addEventListener('click', () => {
        searchZipCode(Elements.zipSearch.value);
    });

    // ZIP search - Enter key
    Elements.zipSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            searchZipCode(Elements.zipSearch.value);
        }
    });

    // Mobile panel toggle
    Elements.mobileToggle.addEventListener('click', () => {
        Elements.controlPanel.classList.toggle('collapsed');
    });

    // Auto-collapse on mobile after state selection
    Elements.stateSelect.addEventListener('change', () => {
        if (window.innerWidth <= 768) {
            setTimeout(() => {
                Elements.controlPanel.classList.add('collapsed');
            }, 300);
        }
    });

    // Auto-collapse on mobile after ZIP search
    Elements.searchBtn.addEventListener('click', () => {
        if (window.innerWidth <= 768 && Elements.zipSearch.value.length === 5) {
            setTimeout(() => {
                Elements.controlPanel.classList.add('collapsed');
            }, 500);
        }
    });
}

/**
 * Initialize the application
 */
async function init() {
    // Cache DOM elements
    cacheElements();
    
    // Initialize map
    initMap();
    
    // Populate dropdown
    populateStateDropdown();
    
    // Load CSV data (required for all operations)
    showLoading(true, 'Loading price data...');
    await loadZHVIData();
    showLoading(false);

    // Set up event listeners
    setupEventListeners();

    console.log('ZHVI Map initialized successfully!');
    console.log('Architecture: Lazy loading - GeoJSON only loaded on state selection');
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
