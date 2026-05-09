const fs = require('fs');

async function fetchRivers() {
    console.log("Fetching river data from Overpass API...");
    const query = `
        [out:json][timeout:25];
        area["name"="広島市"]->.searchArea;
        (
          way["waterway"="river"](area.searchArea);
        );
        out body;
        >;
        out skel qt;
    `;
    try {
        const urls = [
            "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://lz4.overpass-api.de/api/interpreter",
        "https://z.overpass-api.de/api/interpreter"
    ];
    
    let response = null;
    for (const url of urls) {
        try {
            console.log(`Trying ${url}...`);
            response = await fetch(url, {
                method: 'POST',
                body: "data=" + encodeURIComponent(query),
                signal: AbortSignal.timeout(30000) // 30 second timeout
            });
            if (response.ok) {
                console.log(`Success with ${url}`);
                break;
            } else {
                console.log(`HTTP error ${response.status} with ${url}`);
            }
        } catch (err) {
            console.log(`Failed with ${url}: ${err.message}`);
        }
    }

    if (!response || !response.ok) {
        throw new Error("All Overpass API endpoints failed.");
    }
        const data = await response.json();
        
        // Simple conversion to GeoJSON
        const elements = data.elements;
        const nodes = {};
        elements.filter(e => e.type === 'node').forEach(n => {
            nodes[n.id] = [n.lon, n.lat];
        });
        
        const features = elements.filter(e => e.type === 'way').map(way => {
            const coordinates = way.nodes.map(nodeId => nodes[nodeId]).filter(Boolean);
            if (coordinates.length < 2) return null;
            return {
                type: "Feature",
                properties: {
                    name: way.tags?.name || "Unknown River",
                    id: way.id
                },
                geometry: {
                    type: "LineString",
                    coordinates: coordinates
                }
            };
        }).filter(Boolean);
        
        const geojson = {
            type: "FeatureCollection",
            features: features
        };
        
        fs.writeFileSync("rivers.geojson", JSON.stringify(geojson));
        console.log("rivers.geojson saved.");
    } catch (e) {
        console.error("Error:", e);
    }
}
fetchRivers();
