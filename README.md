# ZHVI Median Home Price Web Map (2000-2025)

An interactive web map visualizing Zillow Home Value Index (ZHVI) median single-family home prices by ZIP code across the United States from 2000 to 2025.

## Features

- 🗺️ **Interactive Map**: Explore home prices by ZIP code across all 50 states + DC
- 🎛️ **State Toggle**: Load states on-demand to keep performance smooth
- 📅 **Time Slider**: View price changes from 2000 to 2025
- ▶️ **Animated Timeline**: Watch prices change over time with play/pause
- 📊 **Statistics**: See median, lowest, and highest prices for each state/year
- 🎨 **Beautiful UI**: Modern dark theme with smooth animations

## Getting Started

### Option 1: Using Python (Recommended)

```bash
# Navigate to the project folder
cd "path/to/ZHVI_Median_Home_Price_2000-2025"

# Start a local server
python -m http.server 8000

# Open in browser
# http://localhost:8000
```

### Option 2: Using Node.js

```bash
# Install http-server globally (one time)
npm install -g http-server

# Navigate to the project folder and run
http-server -p 8000

# Open in browser
# http://localhost:8000
```

### Option 3: VS Code Live Server Extension

1. Install the "Live Server" extension in VS Code
2. Right-click on `index.html`
3. Select "Open with Live Server"

## Project Structure

```
ZHVI_Median_Home_Price_2000-2025/
├── index.html          # Main web application
├── ZHVI_WI.csv         # ZHVI price data (all states)
├── README.md           # This file
└── geojsons/           # State-level ZIP code boundaries
    ├── wi_wisconsin_zip_codes_geo.min.json
    ├── ca_california_zip_codes_geo.min.json
    └── ... (50 states + DC)
```

## Data Sources

- **Price Data**: Zillow Home Value Index (ZHVI) - Single Family Homes
- **ZIP Code Boundaries**: US Census Bureau ZCTA boundaries

## How It Works

The map uses **lazy loading** to maintain performance:
1. Initially, no ZIP code geometries are loaded
2. When you select a state, only that state's GeoJSON is fetched
3. Price data is matched to ZIP codes in real-time
4. Changing the year re-colors the map without reloading geometries

This approach keeps the browser responsive even with large datasets.

## Browser Compatibility

Works in all modern browsers:
- Chrome (recommended)
- Firefox
- Safari
- Edge

## License

Data from Zillow and US Census Bureau. For educational/research purposes.
