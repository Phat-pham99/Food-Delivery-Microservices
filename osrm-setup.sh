#!/bin/bash
# =============================================================================
# OSRM Data Setup Script
# Downloads and pre-processes OpenStreetMap data for OSRM routing engine
# Region: New York State (covers all seed data coordinates in Manhattan area)
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/osrm-data"
REGION="new-york"
OSM_FILE="${REGION}-latest.osm.pbf"
DOWNLOAD_URL="https://download.geofabrik.de/north-america/us/${OSM_FILE}"

echo "🗺️  OSRM Data Setup for Food Delivery Platform"
echo "================================================"
echo "Region: New York State"
echo "Data directory: ${DATA_DIR}"
echo ""

# Create data directory
mkdir -p "${DATA_DIR}"

# Step 1: Download OSM extract
if [ -f "${DATA_DIR}/${OSM_FILE}" ]; then
  echo "✅ OSM file already exists, skipping download"
  echo "   (Delete ${DATA_DIR}/${OSM_FILE} to force re-download)"
else
  echo "📥 Downloading New York OSM extract from Geofabrik..."
  echo "   URL: ${DOWNLOAD_URL}"
  echo "   This may take a few minutes depending on your connection..."
  wget -q --show-progress -O "${DATA_DIR}/${OSM_FILE}" "${DOWNLOAD_URL}"
  echo "✅ Download complete"
fi

echo ""

# Step 2: Extract — builds the routing graph from OSM data
if [ -f "${DATA_DIR}/${REGION}-latest.osrm" ]; then
  echo "✅ OSRM extract already exists, skipping"
else
  echo "🔧 Step 1/3: Extracting routing data (osrm-extract)..."
  echo "   This processes the OSM file into OSRM's internal format."
  echo "   Using car.lua profile for driving routes."
  docker run --rm -v "${DATA_DIR}:/data" osrm/osrm-backend \
    osrm-extract -p /opt/car.lua /data/${OSM_FILE}
  echo "✅ Extract complete"
fi

echo ""

# Step 3: Partition — required for MLD algorithm
if [ -f "${DATA_DIR}/${REGION}-latest.osrm.partition" ]; then
  echo "✅ OSRM partition already exists, skipping"
else
  echo "🔧 Step 2/3: Partitioning graph (osrm-partition)..."
  echo "   This creates the multi-level overlay for fast routing."
  docker run --rm -v "${DATA_DIR}:/data" osrm/osrm-backend \
    osrm-partition /data/${REGION}-latest.osrm
  echo "✅ Partition complete"
fi

echo ""

# Step 4: Customize — final pre-processing step
if [ -f "${DATA_DIR}/${REGION}-latest.osrm.cell_metrics" ]; then
  echo "✅ OSRM customization already exists, skipping"
else
  echo "🔧 Step 3/3: Customizing graph (osrm-customize)..."
  echo "   This computes the cell metrics for the MLD algorithm."
  docker run --rm -v "${DATA_DIR}:/data" osrm/osrm-backend \
    osrm-customize /data/${REGION}-latest.osrm
  echo "✅ Customize complete"
fi

echo ""
echo "================================================"
echo "🎉 OSRM data preparation complete!"
echo ""
echo "To start the OSRM server, run:"
echo "  docker compose up osrm"
echo ""
echo "Or standalone:"
echo "  docker run -p 5050:5000 -v ${DATA_DIR}:/data osrm/osrm-backend \\"
echo "    osrm-routed --algorithm mld /data/${REGION}-latest.osrm"
echo ""
echo "Test with:"
echo "  curl 'http://localhost:5050/table/v1/driving/-74.006,40.7128;-73.9851,40.7589'"
echo ""
