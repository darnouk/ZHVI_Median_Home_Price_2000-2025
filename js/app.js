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
    isDataLoaded: false,   // Track if CSV is loaded
    // Affordability feature
    affordabilityMode: false,
    maxAffordablePrice: null,  // Calculated from income (3.5x multiplier)
    AFFORDABILITY_MULTIPLIER: 3.5,  // Standard mortgage qualification rule
    // Comparison feature
    compareZips: { zip1: null, zip2: null, zip3: null },
    // Last searched ZIP (for updating display on year change)
    lastSearchedZip: null
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
    // Affordability elements
    Elements.incomeInput = document.getElementById('incomeInput');
    Elements.affordabilityToggle = document.getElementById('affordabilityToggle');
    Elements.affordabilityInfo = document.getElementById('affordabilityInfo');
    // Welcome modal
    Elements.welcomeModal = document.getElementById('welcomeModal');
    Elements.welcomeClose = document.getElementById('welcomeClose');
    // Compare panel elements
    Elements.comparePanel = document.getElementById('comparePanel');
    Elements.compareToggle = document.getElementById('compareToggle');
    Elements.compareClose = document.getElementById('compareClose');
    Elements.compareZip1 = document.getElementById('compareZip1');
    Elements.compareZip2 = document.getElementById('compareZip2');
    Elements.compareZip3 = document.getElementById('compareZip3');
    Elements.compareAddThird = document.getElementById('compareAddThird');
    Elements.compareThirdGroup = document.getElementById('compareThirdGroup');
    Elements.compareGenerateBtn = document.getElementById('compareGenerateBtn');
    Elements.compareError = document.getElementById('compareError');
    Elements.compareResults = document.getElementById('compareResults');
    Elements.compareBackdrop = document.getElementById('compareBackdrop');
}

/**
 * Initialize the Leaflet map
 */
function initMap() {
    AppState.map = L.map('map', {
        center: [39.8, -98.5],
        zoom: 4,
        zoomControl: false,  // Disable default, we'll add custom position
        attributionControl: true,
        preferCanvas: true  // Canvas renderer for better performance
    });
    
    // Add zoom control to bottom right
    L.control.zoom({
        position: 'bottomright'
    }).addTo(AppState.map);

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

    // Affordability mode styling
    if (AppState.affordabilityMode && AppState.maxAffordablePrice) {
        const isAffordable = price > 0 && price <= AppState.maxAffordablePrice;
        const isNoData = !price || price === 0;
        
        return {
            fillColor: isNoData ? '#6b7280' : (isAffordable ? '#10b981' : '#1e293b'),
            weight: isAffordable ? 1.5 : 0.5,
            opacity: isAffordable ? 0.8 : 0.3,
            color: isAffordable ? '#059669' : '#0f172a',
            fillOpacity: isNoData ? 0.3 : (isAffordable ? 0.7 : 0.15),
            lineCap: 'round',
            lineJoin: 'round'
        };
    }

    // Normal mode styling
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
    // Works for both desktop (hover) and mobile (tap)
    layer.on({
        mouseover: (e) => highlightFeature(e, feature),
        mouseout: resetHighlight,
        click: (e) => {
            // On click/tap, show popup with full history
            showPriceHistoryPopup(e, feature);
        }
    });
}

/**
 * Generate and show popup with full price history
 * @param {Object} e - Leaflet event
 * @param {Object} feature - GeoJSON feature
 */
function showPriceHistoryPopup(e, feature) {
    const zip = feature.properties.ZCTA5CE10;
    const data = AppState.zhviData[zip];
    
    let popupContent = `<div class="price-history-popup">`;
    popupContent += `<div class="popup-header">ZIP Code ${zip}</div>`;
    
    if (data) {
        // Find years with data
        const yearsWithData = [];
        for (let year = 2000; year <= 2025; year++) {
            const price = parseFloat(data[year]);
            if (price > 0) {
                yearsWithData.push({ year, price });
            }
        }
        
        if (yearsWithData.length > 0) {
            // Calculate overall change
            const firstYear = yearsWithData[0];
            const lastYear = yearsWithData[yearsWithData.length - 1];
            const overallChange = ((lastYear.price - firstYear.price) / firstYear.price * 100).toFixed(1);
            const isPositive = overallChange >= 0;
            
            popupContent += `<div class="popup-summary">`;
            popupContent += `<span class="popup-current">${formatCurrency(lastYear.price)}</span>`;
            popupContent += `<span class="popup-change ${isPositive ? 'positive' : 'negative'}">${isPositive ? '+' : ''}${overallChange}% since ${firstYear.year}</span>`;
            popupContent += `</div>`;
            
            popupContent += `<div class="popup-divider"></div>`;
            popupContent += `<div class="popup-title">Price History</div>`;
            popupContent += `<div class="popup-grid">`;
            
            // Show all years with data in a grid
            yearsWithData.forEach((item, index) => {
                // Calculate year-over-year change
                let yoyChange = '';
                if (index > 0) {
                    const prevPrice = yearsWithData[index - 1].price;
                    const change = ((item.price - prevPrice) / prevPrice * 100).toFixed(1);
                    const yoyPositive = change >= 0;
                    yoyChange = `<span class="yoy-change ${yoyPositive ? 'positive' : 'negative'}">${yoyPositive ? '+' : ''}${change}%</span>`;
                }
                
                popupContent += `<div class="popup-row">`;
                popupContent += `<span class="popup-year">${item.year}</span>`;
                popupContent += `<span class="popup-price">${formatCurrency(item.price)}</span>`;
                popupContent += yoyChange;
                popupContent += `</div>`;
            });
            
            popupContent += `</div>`;
        } else {
            popupContent += `<div class="popup-no-data">No price data available</div>`;
        }
    } else {
        popupContent += `<div class="popup-no-data">No data available for this ZIP code</div>`;
    }
    
    popupContent += `</div>`;
    
    // Create and open popup
    L.popup({
        maxWidth: 300,
        minWidth: 200,
        className: 'price-history-popup-container'
    })
    .setLatLng(e.latlng)
    .setContent(popupContent)
    .openOn(AppState.map);
}

/**
 * Highlight a feature on hover
 * @param {Object} e - Leaflet event
 * @param {Object} feature - GeoJSON feature
 */
function highlightFeature(e, feature) {
    const layer = e.target;
    
    // Calculate fill opacity based on zoom level
    // At zoom 4-8: opacity 1.0 (full), at zoom 16+: opacity 0.3 (minimal)
    const zoom = AppState.map.getZoom();
    const minZoom = 8;
    const maxZoom = 16;
    const maxOpacity = 1.0;
    const minOpacity = 0.3;
    
    let fillOpacity;
    if (zoom <= minZoom) {
        fillOpacity = maxOpacity;
    } else if (zoom >= maxZoom) {
        fillOpacity = minOpacity;
    } else {
        // Linear interpolation between min and max
        const t = (zoom - minZoom) / (maxZoom - minZoom);
        fillOpacity = maxOpacity - (t * (maxOpacity - minOpacity));
    }
    
    layer.setStyle({
        weight: 2.5,
        color: '#ffffff',
        fillOpacity: fillOpacity,
        lineCap: 'round',
        lineJoin: 'round'
    });

    layer.bringToFront();

    // Update info panel
    const zip = feature.properties.ZCTA5CE10;
    const data = AppState.zhviData[zip];

    if (data) {
        const currentPrice = parseFloat(data[AppState.currentYear]) || 0;
        
        // Find the earliest year with data for this ZIP code
        let earliestYear = null;
        let basePrice = 0;
        for (let year = 2000; year <= AppState.currentYear; year++) {
            const price = parseFloat(data[year]);
            if (price > 0) {
                earliestYear = year;
                basePrice = price;
                break;
            }
        }
        
        Elements.infoZip.textContent = `ZIP Code: ${zip}`;
        Elements.infoPrice.textContent = formatCurrency(currentPrice);
        
        if (basePrice > 0 && currentPrice > 0 && earliestYear !== null && earliestYear < AppState.currentYear) {
            const change = ((currentPrice - basePrice) / basePrice * 100).toFixed(1);
            const isPositive = change >= 0;
            Elements.infoChange.textContent = `${isPositive ? '+' : ''}${change}% since ${earliestYear}`;
            Elements.infoChange.className = `info-change ${isPositive ? 'positive' : 'negative'}`;
        } else if (earliestYear === AppState.currentYear) {
            Elements.infoChange.textContent = 'First year of data';
            Elements.infoChange.className = 'info-change';
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
    
    // Update affordability display if active
    if (AppState.affordabilityMode) {
        updateAffordabilityDisplay();
    }
    
    // Note: Comparison inputs are NOT cleared on state change
    // Users can compare ZIP codes from any state
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
        
        // Update affordability display if active
        if (AppState.affordabilityMode) {
            updateAffordabilityDisplay();
        }
        
        // Update comparison if active
        if (AppState.compareZips.zip1 || AppState.compareZips.zip2) {
            updateComparisonResults();
        }
        
        // Update search result display if a ZIP was searched
        updateSearchResultDisplay();
    }
}

/**
 * Update the search result display when year changes
 */
function updateSearchResultDisplay() {
    // Only update if there's a success message showing (last searched ZIP)
    if (AppState.lastSearchedZip && Elements.searchError.classList.contains('success')) {
        const data = AppState.zhviData[AppState.lastSearchedZip];
        if (data) {
            const price = parseFloat(data[AppState.currentYear]) || 0;
            Elements.searchError.textContent = `Found! ${formatCurrency(price)} in ${AppState.currentYear}`;
        }
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
    // Clear last searched ZIP at start of new search
    AppState.lastSearchedZip = null;
    
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
                // Store the searched ZIP for updating on year change
                AppState.lastSearchedZip = zip;
            } else {
                Elements.searchError.textContent = 'ZIP found but no price data available';
                Elements.searchError.className = 'search-error';
                AppState.lastSearchedZip = null;
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

    // Year step buttons (for mobile)
    const yearPrevBtn = document.getElementById('yearPrev');
    const yearNextBtn = document.getElementById('yearNext');
    
    if (yearPrevBtn) {
        yearPrevBtn.addEventListener('click', () => {
            const newYear = Math.max(2000, AppState.currentYear - 1);
            Elements.yearSlider.value = newYear;
            updateYear(newYear);
        });
    }
    
    if (yearNextBtn) {
        yearNextBtn.addEventListener('click', () => {
            const newYear = Math.min(2025, AppState.currentYear + 1);
            Elements.yearSlider.value = newYear;
            updateYear(newYear);
        });
    }

    // Play button
    Elements.playBtn.addEventListener('click', togglePlay);

    // Scale toggle
    Elements.scaleState.addEventListener('click', () => setScaleMode('state'));
    Elements.scaleNational.addEventListener('click', () => setScaleMode('national'));

    // ZIP search - input validation
    Elements.zipSearch.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        Elements.searchError.textContent = '';
        // Clear last searched ZIP when user modifies input
        AppState.lastSearchedZip = null;
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

    // Affordability - format income input with commas
    Elements.incomeInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value) {
            value = parseInt(value).toLocaleString();
        }
        e.target.value = value;
        
        // Update max affordable price
        const income = parseInt(value.replace(/,/g, '')) || 0;
        AppState.maxAffordablePrice = income > 0 ? income * AppState.AFFORDABILITY_MULTIPLIER : null;
        
        // If affordability mode is active, update display
        if (AppState.affordabilityMode && AppState.currentLayer) {
            updateAffordabilityDisplay();
            AppState.currentLayer.setStyle(styleFeature);
        }
    });

    // Affordability toggle button
    Elements.affordabilityToggle.addEventListener('click', () => {
        toggleAffordabilityMode();
    });

    // Affordability - Enter key
    Elements.incomeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !AppState.affordabilityMode) {
            toggleAffordabilityMode();
        }
    });

    // Info tooltip click support (for touch devices)
    const infoTooltip = document.querySelector('.info-tooltip');
    const tooltipContent = document.querySelector('.tooltip-content');
    
    if (infoTooltip && tooltipContent) {
        // Position the tooltip when showing
        const positionTooltip = () => {
            const rect = infoTooltip.getBoundingClientRect();
            const tooltipWidth = 280;
            
            // Position to the right of the icon, or left if not enough space
            let left = rect.right + 10;
            if (left + tooltipWidth > window.innerWidth - 20) {
                left = rect.left - tooltipWidth - 10;
            }
            if (left < 20) {
                left = 20;
            }
            
            // Vertically center with the icon
            let top = rect.top - 10;
            
            // Make sure it doesn't go off screen
            const tooltipHeight = tooltipContent.offsetHeight || 200;
            if (top + tooltipHeight > window.innerHeight - 20) {
                top = window.innerHeight - tooltipHeight - 20;
            }
            if (top < 20) {
                top = 20;
            }
            
            tooltipContent.style.left = `${left}px`;
            tooltipContent.style.top = `${top}px`;
        };
        
        infoTooltip.addEventListener('mouseenter', positionTooltip);
        
        infoTooltip.addEventListener('click', (e) => {
            e.stopPropagation();
            positionTooltip();
            infoTooltip.classList.toggle('active');
        });
        
        // Close tooltip when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!infoTooltip.contains(e.target)) {
                infoTooltip.classList.remove('active');
            }
        });
    }

    // Scale tooltip (Color Scale info)
    const scaleTooltip = document.querySelector('.scale-tooltip');
    const scaleTooltipContent = scaleTooltip ? scaleTooltip.querySelector('.tooltip-content') : null;
    
    if (scaleTooltip && scaleTooltipContent) {
        const positionScaleTooltip = () => {
            const rect = scaleTooltip.getBoundingClientRect();
            const tooltipWidth = 280;
            
            let left = rect.right + 10;
            if (left + tooltipWidth > window.innerWidth - 20) {
                left = rect.left - tooltipWidth - 10;
            }
            if (left < 20) {
                left = 20;
            }
            
            let top = rect.top - 10;
            const tooltipHeight = scaleTooltipContent.offsetHeight || 150;
            if (top + tooltipHeight > window.innerHeight - 20) {
                top = window.innerHeight - tooltipHeight - 20;
            }
            if (top < 20) {
                top = 20;
            }
            
            scaleTooltipContent.style.left = `${left}px`;
            scaleTooltipContent.style.top = `${top}px`;
        };
        
        scaleTooltip.addEventListener('mouseenter', positionScaleTooltip);
        
        scaleTooltip.addEventListener('click', (e) => {
            e.stopPropagation();
            positionScaleTooltip();
            scaleTooltip.classList.toggle('active');
        });
        
        document.addEventListener('click', (e) => {
            if (!scaleTooltip.contains(e.target)) {
                scaleTooltip.classList.remove('active');
            }
        });
    }

    // Welcome modal
    if (Elements.welcomeClose && Elements.welcomeModal) {
        // Check if user has seen the modal before
        const hasSeenWelcome = localStorage.getItem('zhvi_welcome_seen');
        
        // Show modal only if user hasn't seen it before
        Elements.welcomeModal.classList.remove('hidden');
        
        const closeWelcomeModal = () => {
            Elements.welcomeModal.classList.add('hidden');
            localStorage.setItem('zhvi_welcome_seen', 'true');
        };
        
        Elements.welcomeClose.addEventListener('click', (e) => {
            e.stopPropagation();
            closeWelcomeModal();
        });
        
        // Also close on clicking outside the content
        Elements.welcomeModal.addEventListener('click', (e) => {
            // Only close if clicking the backdrop, not the content
            if (e.target === Elements.welcomeModal) {
                closeWelcomeModal();
            }
        });
        
        // Prevent clicks inside content from bubbling to modal backdrop
        const welcomeContent = Elements.welcomeModal.querySelector('.welcome-content');
        if (welcomeContent) {
            welcomeContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }
}

/**
 * Toggle affordability mode on/off
 */
function toggleAffordabilityMode() {
    const income = parseInt(Elements.incomeInput.value.replace(/,/g, '')) || 0;
    
    if (income <= 0) {
        Elements.affordabilityInfo.textContent = 'Enter your annual income first';
        Elements.affordabilityInfo.style.color = '#f87171';
        setTimeout(() => {
            Elements.affordabilityInfo.textContent = '';
            Elements.affordabilityInfo.style.color = '';
        }, 2000);
        return;
    }
    
    AppState.affordabilityMode = !AppState.affordabilityMode;
    AppState.maxAffordablePrice = income * AppState.AFFORDABILITY_MULTIPLIER;
    
    // Update toggle button
    Elements.affordabilityToggle.classList.toggle('active', AppState.affordabilityMode);
    
    if (AppState.affordabilityMode) {
        updateAffordabilityDisplay();
    } else {
        Elements.affordabilityInfo.innerHTML = '';
    }
    
    // Re-style the map
    if (AppState.currentLayer) {
        AppState.currentLayer.setStyle(styleFeature);
    }
}

/**
 * Update the affordability info display
 */
function updateAffordabilityDisplay() {
    if (!AppState.currentGeoJSON || !AppState.affordabilityMode) return;
    
    const maxPrice = AppState.maxAffordablePrice;
    let affordableCount = 0;
    let totalWithData = 0;
    
    AppState.currentGeoJSON.features.forEach(feature => {
        const zip = feature.properties.ZCTA5CE10;
        const data = AppState.zhviData[zip];
        if (data && data[AppState.currentYear]) {
            const price = parseFloat(data[AppState.currentYear]);
            if (price > 0) {
                totalWithData++;
                if (price <= maxPrice) {
                    affordableCount++;
                }
            }
        }
    });
    
    const percentage = totalWithData > 0 ? Math.round((affordableCount / totalWithData) * 100) : 0;
    
    Elements.affordabilityInfo.innerHTML = `
        <span class="affordable-count">${affordableCount} ZIP codes</span> affordable 
        (${percentage}%) · Max: <span class="max-price">${formatCurrency(maxPrice)}</span>
    `;
}

/**
 * Add ZIP codes to comparison
 * @param {string} zip1 - First ZIP code
 * @param {string} zip2 - Second ZIP code
 * @param {string} zip3 - Third ZIP code (optional)
 */
function generateComparison(zip1, zip2, zip3) {
    // Clear previous error
    Elements.compareError.textContent = '';
    
    // Validate required ZIPs
    if (!zip1 || zip1.length !== 5) {
        Elements.compareError.textContent = 'Please enter a valid 5-digit ZIP code for ZIP Code 1';
        return;
    }
    
    if (!zip2 || zip2.length !== 5) {
        Elements.compareError.textContent = 'Please enter a valid 5-digit ZIP code for ZIP Code 2';
        return;
    }

    // Validate optional ZIP3 if provided
    if (zip3 && zip3.length !== 5) {
        Elements.compareError.textContent = 'Please enter a valid 5-digit ZIP code for ZIP Code 3';
        return;
    }

    // Check if ZIPs exist in database (no state restriction - compare any ZIPs)
    const data1 = AppState.zhviData[zip1];
    const data2 = AppState.zhviData[zip2];
    const data3 = zip3 ? AppState.zhviData[zip3] : null;
    
    if (!data1) {
        Elements.compareError.textContent = `ZIP ${zip1} not found in database`;
        return;
    }
    
    if (!data2) {
        Elements.compareError.textContent = `ZIP ${zip2} not found in database`;
        return;
    }

    if (zip3 && !data3) {
        Elements.compareError.textContent = `ZIP ${zip3} not found in database`;
        return;
    }

    // Store comparison
    AppState.compareZips = { zip1, zip2, zip3: zip3 || null };
    
    // Update results
    updateComparisonResults();
}

/**
 * Get ZIP code statistics for comparison
 * @param {string} zip - ZIP code
 * @returns {Object} Statistics object
 */
function getZipStats(zip) {
    const data = AppState.zhviData[zip];
    if (!data) return null;

    const yearsWithData = [];
    for (let year = 2000; year <= 2025; year++) {
        const price = parseFloat(data[year]);
        if (price > 0) {
            yearsWithData.push({ year, price });
        }
    }

    if (yearsWithData.length === 0) return null;

    const firstYear = yearsWithData[0];
    const lastYear = yearsWithData[yearsWithData.length - 1];
    const currentYearData = yearsWithData.find(y => y.year === AppState.currentYear);
    const currentPrice = currentYearData ? currentYearData.price : lastYear.price;

    // Calculate various stats
    const overallChange = ((lastYear.price - firstYear.price) / firstYear.price * 100);
    const avgYearlyChange = overallChange / (lastYear.year - firstYear.year);
    
    // Find peak price
    const peak = yearsWithData.reduce((max, y) => y.price > max.price ? y : max, yearsWithData[0]);
    
    // Find lowest price
    const lowest = yearsWithData.reduce((min, y) => y.price < min.price ? y : min, yearsWithData[0]);

    return {
        zip,
        currentPrice,
        firstYear: firstYear.year,
        firstPrice: firstYear.price,
        lastYear: lastYear.year,
        lastPrice: lastYear.price,
        overallChange,
        avgYearlyChange,
        peakYear: peak.year,
        peakPrice: peak.price,
        lowestYear: lowest.year,
        lowestPrice: lowest.price,
        dataYears: yearsWithData.length
    };
}

/**
 * Update the comparison results display
 */
function updateComparisonResults() {
    const { zip1, zip2, zip3 } = AppState.compareZips;

    // If neither ZIP is set, show placeholder and collapse panel width
    if (!zip1 && !zip2) {
        Elements.comparePanel.classList.remove('expanded');
        Elements.compareResults.innerHTML = `
            <div class="compare-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M3 3v18h18"/>
                    <path d="M7 16l4-8 4 4 6-6"/>
                </svg>
                <p>Enter two or three ZIP codes to compare their price history</p>
            </div>
        `;
        return;
    }

    // Chart container (only if both required ZIPs are set)
    if (zip1 && zip2) {
        // Expand panel for better chart visibility
        Elements.comparePanel.classList.add('expanded');
        Elements.compareResults.innerHTML = '<div class="compare-chart-container"><canvas id="compareChart"></canvas></div>';
        // Small delay to allow panel to expand before drawing
        setTimeout(() => drawComparisonChart(zip1, zip2, zip3), 50);
    } else {
        Elements.comparePanel.classList.remove('expanded');
        Elements.compareResults.innerHTML = `
            <div class="compare-placeholder">
                <p>Please enter at least two ZIP codes to generate comparison</p>
            </div>
        `;
    }
}

/**
 * Draw comparison line chart for up to three ZIP codes with interactive crosshair
 * @param {string} zip1 - First ZIP code
 * @param {string} zip2 - Second ZIP code
 * @param {string} zip3 - Third ZIP code (optional)
 */
function drawComparisonChart(zip1, zip2, zip3) {
    const canvas = document.getElementById('compareChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const data1 = AppState.zhviData[zip1];
    const data2 = AppState.zhviData[zip2];
    const data3 = zip3 ? AppState.zhviData[zip3] : null;

    if (!data1 || !data2) return;

    // Colors for each ZIP - accessible color palette
    const colors = {
        zip1: '#ff4444',  // Red
        zip2: '#4488ff',  // Blue
        zip3: '#22c55e'   // Green (accessible, contrasts with red/blue)
    };

    // Collect data points for all ZIPs
    const years = [];
    const prices1 = [];
    const prices2 = [];
    const prices3 = [];

    for (let year = 2000; year <= 2025; year++) {
        const price1 = parseFloat(data1[year]);
        const price2 = parseFloat(data2[year]);
        const price3 = data3 ? parseFloat(data3[year]) : 0;
        
        // Only include years where at least one ZIP has data
        if ((price1 > 0) || (price2 > 0) || (price3 > 0)) {
            years.push(year);
            prices1.push(price1 > 0 ? price1 : null);
            prices2.push(price2 > 0 ? price2 : null);
            prices3.push(price3 > 0 ? price3 : null);
        }
    }

    if (years.length === 0) return;

    // Set canvas size with proper DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const containerWidth = canvas.parentElement.clientWidth;
    const displayWidth = containerWidth - 20;
    const displayHeight = 280;
    
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';
    
    ctx.scale(dpr, dpr);

    // Chart dimensions with proper padding
    const padding = { top: 60, right: 25, bottom: 45, left: 65 };
    const chartWidth = displayWidth - padding.left - padding.right;
    const chartHeight = displayHeight - padding.top - padding.bottom;

    // Find min/max for scaling (include zip3 if present)
    const allPrices = [
        ...prices1.filter(p => p !== null),
        ...prices2.filter(p => p !== null),
        ...prices3.filter(p => p !== null)
    ];
    const minPrice = Math.min(...allPrices) * 0.90;
    const maxPrice = Math.max(...allPrices) * 1.10;

    // Helper functions
    const getX = (index) => padding.left + (index / (years.length - 1)) * chartWidth;
    const getY = (price) => {
        if (price === null) return null;
        return padding.top + chartHeight - ((price - minPrice) / (maxPrice - minPrice)) * chartHeight;
    };

    // Draw a line for a set of prices
    function drawLine(prices, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let firstPoint = true;
        prices.forEach((price, index) => {
            if (price !== null) {
                const x = getX(index);
                const y = getY(price);
                if (firstPoint) {
                    ctx.moveTo(x, y);
                    firstPoint = false;
                } else {
                    ctx.lineTo(x, y);
                }
            }
        });
        ctx.stroke();
    }

    // Draw points for a set of prices
    function drawPoints(prices, color) {
        prices.forEach((price, index) => {
            if (price !== null) {
                const x = getX(index);
                const y = getY(price);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
                ctx.fill();
            }
        });
    }

    // Main draw function
    function drawChart(hoverIndex = -1) {
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        // Clear canvas with dark background
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, displayWidth, displayHeight);

        // Draw grid lines (horizontal only)
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
            const y = padding.top + (chartHeight / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }

        // Draw Y-axis labels (prices)
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= gridLines; i++) {
            const price = minPrice + (maxPrice - minPrice) * (1 - i / gridLines);
            const y = padding.top + (chartHeight / gridLines) * i;
            ctx.fillText(formatCurrency(price), padding.left - 10, y);
        }

        // Draw X-axis labels (years) - show every 5 years
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        years.forEach((year, index) => {
            if (year % 5 === 0) {
                const x = getX(index);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(year.toString(), x, displayHeight - padding.bottom + 10);
            }
        });

        // Draw lines for all ZIPs
        drawLine(prices1, colors.zip1);
        drawLine(prices2, colors.zip2);
        if (zip3) drawLine(prices3, colors.zip3);

        // Draw points for all ZIPs
        drawPoints(prices1, colors.zip1);
        drawPoints(prices2, colors.zip2);
        if (zip3) drawPoints(prices3, colors.zip3);

        // Draw crosshair and tooltip if hovering
        if (hoverIndex >= 0 && hoverIndex < years.length) {
            const hoverX = getX(hoverIndex);
            const hoverYear = years[hoverIndex];
            const hoverPrice1 = prices1[hoverIndex];
            const hoverPrice2 = prices2[hoverIndex];
            const hoverPrice3 = zip3 ? prices3[hoverIndex] : null;

            // Vertical crosshair line
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(hoverX, padding.top);
            ctx.lineTo(hoverX, padding.top + chartHeight);
            ctx.stroke();
            ctx.setLineDash([]);

            // Highlight points on hover
            const highlightPoint = (price, color) => {
                if (price !== null) {
                    const y = getY(price);
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(hoverX, y, 6, 0, 2 * Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = '#ffffff';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            };

            highlightPoint(hoverPrice1, colors.zip1);
            highlightPoint(hoverPrice2, colors.zip2);
            if (zip3) highlightPoint(hoverPrice3, colors.zip3);

            // Tooltip box - adjust height based on number of ZIPs
            const tooltipWidth = 130;
            const tooltipHeight = zip3 ? 74 : 58;
            let tooltipX = hoverX + 10;
            if (tooltipX + tooltipWidth > displayWidth - 10) {
                tooltipX = hoverX - tooltipWidth - 10;
            }
            const tooltipY = padding.top + 10;

            // Tooltip background
            ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight, 6);
            ctx.fill();
            ctx.stroke();

            // Tooltip content
            ctx.fillStyle = '#f8fafc';
            ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(hoverYear.toString(), tooltipX + 10, tooltipY + 8);

            ctx.font = '11px -apple-system, system-ui, sans-serif';
            if (hoverPrice1 !== null) {
                ctx.fillStyle = colors.zip1;
                ctx.fillText(`${zip1}: ${formatCurrency(hoverPrice1)}`, tooltipX + 10, tooltipY + 24);
            }
            if (hoverPrice2 !== null) {
                ctx.fillStyle = colors.zip2;
                ctx.fillText(`${zip2}: ${formatCurrency(hoverPrice2)}`, tooltipX + 10, tooltipY + 40);
            }
            if (zip3 && hoverPrice3 !== null) {
                ctx.fillStyle = colors.zip3;
                ctx.fillText(`${zip3}: ${formatCurrency(hoverPrice3)}`, tooltipX + 10, tooltipY + 56);
            }
        }

        // Title
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 15px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Price History Comparison', displayWidth / 2, 8);

        // Legend - properly centered with dynamic width
        ctx.font = 'bold 12px -apple-system, system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        
        const legendY = 34;
        const dotSize = 6;
        const dotTextGap = 6;
        const zipGap = 20;

        // Build legend items
        const legendItems = [
            { zip: zip1, color: colors.zip1 },
            { zip: zip2, color: colors.zip2 }
        ];
        if (zip3) {
            legendItems.push({ zip: zip3, color: colors.zip3 });
        }

        // Calculate total legend width
        let totalLegendWidth = 0;
        legendItems.forEach((item, i) => {
            totalLegendWidth += dotSize + dotTextGap + ctx.measureText(item.zip).width;
            if (i < legendItems.length - 1) totalLegendWidth += zipGap;
        });

        // Draw legend items
        let currentX = (displayWidth - totalLegendWidth) / 2;
        legendItems.forEach((item, i) => {
            // Draw dot
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.arc(currentX + dotSize / 2, legendY, dotSize / 2, 0, 2 * Math.PI);
            ctx.fill();
            
            // Draw text
            ctx.textAlign = 'left';
            ctx.fillText(item.zip, currentX + dotSize + dotTextGap, legendY);
            
            // Move to next item
            currentX += dotSize + dotTextGap + ctx.measureText(item.zip).width + zipGap;
        });
    }

    // Initial draw
    drawChart();

    // Mouse event handlers for crosshair
    function getHoverIndex(e) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        
        // Check if mouse is in chart area
        if (mouseX < padding.left || mouseX > padding.left + chartWidth) {
            return -1;
        }
        
        // Find nearest data point
        const relativeX = mouseX - padding.left;
        const index = Math.round((relativeX / chartWidth) * (years.length - 1));
        return Math.max(0, Math.min(years.length - 1, index));
    }

    canvas.onmousemove = (e) => {
        const index = getHoverIndex(e);
        drawChart(index);
        canvas.style.cursor = index >= 0 ? 'crosshair' : 'default';
    };

    canvas.onmouseleave = () => {
        drawChart(-1);
        canvas.style.cursor = 'default';
    };

    // Touch event handlers for mobile
    let lastTouchIndex = -1;

    canvas.ontouchstart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };
        lastTouchIndex = getHoverIndex(fakeEvent);
        drawChart(lastTouchIndex);
    };

    canvas.ontouchmove = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY };
        lastTouchIndex = getHoverIndex(fakeEvent);
        drawChart(lastTouchIndex);
    };

    canvas.ontouchend = () => {
        // Keep showing the last touched point for a moment, then clear
        setTimeout(() => {
            drawChart(-1);
            lastTouchIndex = -1;
        }, 1500);
    };
}

/**
 * Set up comparison panel event listeners
 */
function setupCompareListeners() {
    if (!Elements.comparePanel) return;

    const isMobile = () => window.innerWidth <= 768;

    // Helper to open panel (works on both mobile and desktop)
    const openComparePanel = () => {
        Elements.comparePanel.classList.remove('collapsed');
        if (isMobile()) {
            Elements.comparePanel.classList.add('mobile-open');
            Elements.compareBackdrop.classList.add('visible');
            document.body.style.overflow = 'hidden';
        }
    };

    // Helper to close panel
    const closeComparePanel = () => {
        Elements.comparePanel.classList.add('collapsed');
        Elements.comparePanel.classList.remove('mobile-open');
        Elements.comparePanel.classList.remove('expanded');
        if (Elements.compareBackdrop) {
            Elements.compareBackdrop.classList.remove('visible');
        }
        document.body.style.overflow = '';
    };

    // Toggle panel open/closed
    Elements.compareToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        openComparePanel();
    });

    Elements.compareClose.addEventListener('click', () => {
        closeComparePanel();
    });

    // Close on backdrop click (mobile)
    if (Elements.compareBackdrop) {
        Elements.compareBackdrop.addEventListener('click', () => {
            closeComparePanel();
        });
    }

    // Handle orientation/resize changes
    window.addEventListener('resize', () => {
        if (!isMobile() && Elements.comparePanel.classList.contains('mobile-open')) {
            Elements.comparePanel.classList.remove('mobile-open');
            Elements.compareBackdrop.classList.remove('visible');
            document.body.style.overflow = '';
        }
    });

    // Input validation
    Elements.compareZip1.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        Elements.compareError.textContent = '';
    });

    Elements.compareZip2.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        Elements.compareError.textContent = '';
    });

    Elements.compareZip3.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
        Elements.compareError.textContent = '';
    });

    // Add third ZIP code button
    Elements.compareAddThird.addEventListener('click', () => {
        Elements.compareAddThird.classList.add('hidden');
        Elements.compareThirdGroup.classList.remove('hidden');
        Elements.compareZip3.focus();
    });

    // Generate button
    Elements.compareGenerateBtn.addEventListener('click', () => {
        generateComparison(
            Elements.compareZip1.value,
            Elements.compareZip2.value,
            Elements.compareZip3.value || null
        );
    });

    // Enter key support
    Elements.compareZip1.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            generateComparison(
                Elements.compareZip1.value,
                Elements.compareZip2.value,
                Elements.compareZip3.value || null
            );
        }
    });

    Elements.compareZip2.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            generateComparison(
                Elements.compareZip1.value,
                Elements.compareZip2.value,
                Elements.compareZip3.value || null
            );
        }
    });

    Elements.compareZip3.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            generateComparison(
                Elements.compareZip1.value,
                Elements.compareZip2.value,
                Elements.compareZip3.value || null
            );
        }
    });

    // Start collapsed
    Elements.comparePanel.classList.add('collapsed');
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
    
    // Set up compare panel (desktop only)
    setupCompareListeners();

    console.log('ZHVI Map initialized successfully!');
    console.log('Architecture: Lazy loading - GeoJSON only loaded on state selection');
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
