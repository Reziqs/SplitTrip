import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const MODES = [
  { id: 'train', label: 'Train', icon: '🚂' },
  { id: 'car', label: 'Car', icon: '🚗' },
  { id: 'bus', label: 'Bus', icon: '🚌' },
  { id: 'walk', label: 'Walk', icon: '🚶' }
];

const LOGO_URL = 'splittrip.png';

// Helper to convert 2-letter country code to flag emoji (e.g. "gb" -> "🇬🇧")
const getFlagEmoji = (countryCode) => {
  if (!countryCode) return '🌍';
  return countryCode
    .toUpperCase()
    .split('')
    .map(char => String.fromCodePoint(char.charCodeAt(0) + 127397))
    .join('');
};

function CustomDropdown({ value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const dropdownRef = useRef(null);
  const selectedMode = MODES.find(m => m.id === value) || MODES[0];

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target) &&
        !event.target.closest('.dropdown-menu-panel')
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleDropdown = () => {
    if (!isOpen && dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      setMenuStyle({
        position: 'fixed',
        top: `${rect.bottom + window.scrollY + 4}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        zIndex: 999999
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div ref={dropdownRef} className="custom-dropdown-container no-print">
      <div className={`dropdown-trigger ${isOpen ? 'open' : ''}`} onClick={toggleDropdown}>
        <span>{selectedMode.icon} {selectedMode.label}</span>
        <span className="dropdown-arrow">{isOpen ? '▲' : '▼'}</span>
      </div>
      
      {isOpen && ReactDOM.createPortal(
        <div className="dropdown-menu-panel" style={menuStyle}>
          {MODES.map(mode => (
            <div 
              key={mode.id} 
              className={`dropdown-menu-item ${mode.id === value ? 'selected' : ''}`}
              onClick={() => {
                onChange(mode.id);
                setIsOpen(false);
              }}
            >
              <span style={{ marginRight: '8px' }}>{mode.icon}</span> {mode.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

export default function App() {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const [route, setRoute] = useState([]); 
  const [pending, setPending] = useState(null); 
  const [deletingIndex, setDeletingIndex] = useState(null);
  const polylineLayersRef = useRef([]); 
  const midMarkersRef = useRef([]);
  const activePopupRef = useRef(null);

  useEffect(() => {
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([52.3555, -1.1743], 6);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(mapInstance.current);
      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);

      mapInstance.current.on('click', (e) => {
        const { lat, lng } = e.latlng;
        const currentPendingId = Date.now();
        
        const newPending = { 
          lat, 
          lng, 
          name: `Coordinates (${lat.toFixed(3)}, ${lng.toFixed(3)})`, 
          id: currentPendingId,
          country: null,
          countryCode: null
        };
        setPending(newPending);

        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
          .then(res => res.json())
          .then(data => {
            const townName = data.address?.town || data.address?.city || data.address?.village || data.address?.suburb || `Location (${lat.toFixed(2)}, ${lng.toFixed(2)})`;
            // Capture country details for the PDF export
            const country = data.address?.country;
            const countryCode = data.address?.country_code;
            
            setPending(prev => prev && prev.id === currentPendingId ? { ...prev, name: townName, country, countryCode } : prev);
            setRoute(prevRoute => prevRoute.map(item => item.id === currentPendingId ? { ...item, name: townName, country, countryCode } : item));
          })
          .catch(() => {});
      });
    }
  }, []);

  useEffect(() => {
    if (activePopupRef.current) {
      activePopupRef.current.remove();
      activePopupRef.current = null;
    }

    if (pending && mapInstance.current) {
      const container = document.createElement('div');
      container.className = 'popup-confirm-container';
      
      const btn = document.createElement('button');
      btn.className = 'confirm-btn-bubble-static';
      btn.innerHTML = '<span class="modern-tick">✓</span>';
      
      btn.onclick = () => {
        const marker = L.marker([pending.lat, pending.lng]).addTo(mapInstance.current);
        setRoute(prevRoute => [...prevRoute, { ...pending, marker, mode: 'train' }]);
        setPending(null);
      };

      container.appendChild(btn);

      activePopupRef.current = L.popup({
        closeButton: false,
        offset: [0, -10],
        className: 'custom-confirm-popup'
      })
      .setLatLng([pending.lat, pending.lng])
      .setContent(container)
      .openOn(mapInstance.current);
    }
  }, [pending]);

  useEffect(() => {
    polylineLayersRef.current.forEach(layer => layer.remove());
    polylineLayersRef.current = [];
    midMarkersRef.current.forEach(m => m.remove());
    midMarkersRef.current = [];

    if (route.length > 1) {
      for (let i = 0; i < route.length - 1; i++) {
        const start = route[i];
        const end = route[i + 1];
        const currentMode = end.mode || 'train';

        const midLat = (start.lat + end.lat) / 2;
        const midLng = (start.lng + end.lng) / 2;
        const targetMode = MODES.find(m => m.id === currentMode);

        const midIcon = L.divIcon({
          html: `<div class="map-midpoint-badge">${targetMode?.icon || '🚂'}</div>`,
          className: 'custom-div-icon-reset',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
        const midMarker = L.marker([midLat, midLng], { icon: midIcon }).addTo(mapInstance.current);
        midMarkersRef.current.push(midMarker);

        if (currentMode === 'car' || currentMode === 'bus') {
          fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`)
            .then(res => res.json())
            .then(data => {
              if (data.routes && data.routes.length > 0) {
                const roadCoords = data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                const roadLine = L.polyline(roadCoords, { color: '#f97316', weight: 5, smoothFactor: 1 }).addTo(mapInstance.current);
                polylineLayersRef.current.push(roadLine);
              } else {
                const straightLine = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], { color: '#f97316', weight: 5 }).addTo(mapInstance.current);
                polylineLayersRef.current.push(straightLine);
              }
            })
            .catch(() => {
              const straightLine = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], { color: '#f97316', weight: 5 }).addTo(mapInstance.current);
              polylineLayersRef.current.push(straightLine);
            });
        } else {
          const straightLine = L.polyline([[start.lat, start.lng], [end.lat, end.lng]], { color: '#f97316', weight: 5, smoothFactor: 1 }).addTo(mapInstance.current);
          polylineLayersRef.current.push(straightLine);
        }
      }
    }
  }, [route]);

  const removePoint = (index) => {
    setDeletingIndex(index);
    setTimeout(() => {
      const p = route[index];
      if (p.marker) mapInstance.current.removeLayer(p.marker);
      setRoute(prevRoute => prevRoute.filter((_, i) => i !== index));
      setDeletingIndex(null);
    }, 300);
  };

  // 1. Calculate unique countries for the PDF view
  const visitedCountries = route.reduce((acc, p) => {
    if (p.countryCode && !acc.some(c => c.code === p.countryCode)) {
      acc.push({ name: p.country, code: p.countryCode });
    }
    return acc;
  }, []);

  // 2. Custom Print Handler to auto-crop the map before printing
  const handlePrint = () => {
    if (route.length > 0 && mapInstance.current) {
      // Create a bounding box of all points
      const bounds = L.latLngBounds(route.map(p => [p.lat, p.lng]));
      
      // Tell Leaflet to zoom and frame the points perfectly
      mapInstance.current.fitBounds(bounds, { padding: [40, 40], animate: false });
      
      // Wait 600ms for map tiles to load the new bounds before opening print window
      setTimeout(() => {
        window.print();
      }, 600);
    }
  };

  return (
    <div className="app-container">
      <style>{`
        .app-container { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

        .top-navbar { height: 70px; width: 100%; background: #ffffff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; padding: 0 24px; box-sizing: border-box; z-index: 1010; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
        .brand-logo { height: 42px; object-fit: contain; mix-blend-mode: multiply; }

        .view-body { flex: 1; width: 100%; position: relative; }

        .popout-panel { position: absolute; top: 20px; left: 20px; width: 340px; max-height: 85vh; background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(12px); border-radius: 24px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12); z-index: 1000; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.8); box-sizing: border-box; display: flex; flex-direction: column; }
        .panel-title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 20px 0; letter-spacing: -0.025em; }
        .empty-state { color: #64748b; font-size: 14px; margin: 0; }

        .panel-scroll-content { flex: 1; overflow-y: auto; overflow-x: visible; padding: 4px 8px 4px 4px; margin: 0 -8px 16px 0; }

        .waypoint-leg-container { width: 100%; display: flex; flex-direction: column; overflow: visible; position: relative; }
        .waypoint-leg-container.slide-out { animation: slideLeft 0.3s forwards cubic-bezier(0.4, 0, 0.2, 1); }

        .stop-card { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: #f8fafc; border: 1px solid #e2e8f0; box-sizing: border-box; border-radius: 16px; width: 100%; box-shadow: 0 2px 5px rgba(0,0,0,0.02); }
        .stop-info-group { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .stop-name {font-size: 14px; font-weight: 600; color: #334155; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .delete-btn { border: none; background: #fee2e2; color: #ef4444; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; font-weight: bold; font-size: 12px; padding: 0; transition: background 0.2s; flex-shrink: 0; }
        .delete-btn:hover { background: #fca5a5; }

        .custom-div-icon-reset { background: none; border: none; }
        .map-midpoint-badge { display: flex; align-items: center; justify-content: center; font-size: 16px; background: #ffffff; width: 30px; height: 30px; border-radius: 50%; border: 2.5px solid #f97316; box-shadow: 0 4px 10px rgba(0,0,0,0.15); font-family: system-ui, sans-serif; pointer-events: none; }

        .confirm-btn-bubble-static { background: #22c55e; color: white; border: none; width: 44px; height: 44px; border-radius: 50%; box-shadow: 0 8px 16px rgba(34, 197, 94, 0.35); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .confirm-btn-bubble-static:hover { transform: scale(1.1); background: #16a34a; }
        .modern-tick { font-family: system-ui, -apple-system, sans-serif; font-size: 22px; font-weight: 800; line-height: 1; margin-top: -2px; }

        .custom-confirm-popup .leaflet-popup-content-wrapper { background: transparent !important; box-shadow: none !important; border: none !important; padding: 0 !important; }
        .custom-confirm-popup .leaflet-popup-content { margin: 0 !important; width: auto !important; }
        .custom-confirm-popup .leaflet-popup-tip-container { display: none !important; }

        @keyframes slideLeft {
          0% { transform: translateX(0); opacity: 1; max-height: 200px; }
          100% { transform: translateX(-105%); opacity: 0; max-height: 0; padding: 0; margin: 0; }
        }

        .custom-dropdown-container { width: 100%; display: flex; justify-content: center; padding: 8px 0; overflow: visible; }
        .dropdown-trigger { display: flex; justify-content: space-between; align-items: center; width: 140px; padding: 8px 14px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.02); transition: all 0.2s; }
        .dropdown-trigger:hover { border-color: #94a3b8; background: #f8fafc; }
        .dropdown-trigger.open { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }
        .dropdown-arrow { font-size: 9px; color: #94a3b8; }

        .dropdown-menu-panel { background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.15); border: 1px solid #e2e8f0; padding: 6px; box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; }
        .dropdown-menu-item { padding: 8px 12px; font-size: 13px; font-weight: 500; color: #475569; border-radius: 8px; cursor: pointer; transition: background 0.15s; text-align: left; display: flex; align-items: center; }
        .dropdown-menu-item:hover { background: #f1f5f9; color: #0f172a; }
        .dropdown-menu-item.selected { background: #eff6ff; color: #2563eb; font-weight: 600; }

        .export-pdf-btn { width: 100%; padding: 12px; background: #0f172a; color: white; border: none; border-radius: 14px; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .export-pdf-btn:hover { background: #1e293b; }

        /* Map Wrapper Fix for standard screen */
        .print-map-wrapper { height: 100%; width: 100%; position: absolute; top: 0; left: 0; z-index: 0; }

        /* Document classes exclusively for the PDF Print styling */
        .print-mode-text, .print-countries-section, .print-map-header { display: none; }

        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  
         body, html, .app-container { height: auto !important; overflow: visible !important; background: white !important; }
         .top-navbar, .no-print, .delete-btn, .leaflet-control-container { display: none !important; }
  
          .popout-panel { position: relative !important; top: 0 !important; left: 0 !important; width: 100% !important; max-height: none !important; box-shadow: none !important; border: none !important; background: transparent !important; padding: 0 !important; }
         .stop-card { background: #ffffff !important; border: 1px solid #cbd5e1 !important; page-break-inside: avoid; }
         .print-mode-text { display: block !important; text-align: center; color: #475569; font-weight: 600; font-size: 13px; margin: 8px 0; }
  
          .print-countries-section { display: block !important; margin: 30px 0; padding-top: 20px; border-top: 2px dashed #cbd5e1; }
         .print-countries-title { font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
         .countries-grid { display: flex; flex-wrap: wrap; gap: 12px; }
         .country-badge { background: #f8fafc; border: 1px solid #e2e8f0; padding: 6px 12px; border-radius: 8px; font-weight: 600; font-size: 14px; display: flex; align-items: center; gap: 8px; }

         /* OVERRIDE absolute positioning so the map stacks BELOW the text natively */
         .print-map-wrapper { 
           position: relative !important; 
           page-break-before: always !important; /* Pushes map onto a clean second page */
           padding-top: 20px; 
           height: auto !important; 
         }
  
       .print-map-header { display: block !important; text-align: left; font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
  
         /* Make the map container taller to fit a Portrait A4 page nicely */
         #map-container-zone { 
           position: relative !important; 
           height: 800px !important; 
           width: 100% !important; 
           border: 2px solid #e2e8f0;
            border-radius: 16px;
            overflow: hidden;
            page-break-inside: avoid;
          }
        }
      `}</style>

      <header className="top-navbar no-print">
        <img src={LOGO_URL} alt="Split Trip Logo" className="brand-logo" />
      </header>

      <div className="view-body">
        <div className="popout-panel">
          <h2 className="panel-title">Your Trip</h2>
          
          <div className="panel-scroll-content">
            {route.length === 0 && <p className="empty-state">Click map to plot custom points.</p>}
            
            {route.map((p, i) => {
              const currentModeObj = MODES.find(m => m.id === (p.mode || 'train'));
              return (
                <div key={p.id} className={`waypoint-leg-container ${deletingIndex === i ? 'slide-out' : ''}`}>
                  {i > 0 && (
                    <>
                      <CustomDropdown 
                        value={p.mode || 'train'} 
                        onChange={(newMode) => {
                          const r = [...route];
                          r[i].mode = newMode;
                          setRoute(r);
                        }}
                      />
                      <div className="print-mode-text">
                        ↳ Take {currentModeObj?.icon} {currentModeObj?.label} to:
                      </div>
                    </>
                  )}
                  
                  <div className="stop-card">
                    <div className="stop-info-group">
                      <span className="stop-name">{p.name}</span>
                    </div>
                    <button className="delete-btn" onClick={() => removePoint(i)}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          {visitedCountries.length > 0 && (
            <div className="print-countries-section">
              <div className="print-countries-title">Countries Travelled</div>
              <div className="countries-grid">
                {visitedCountries.map(c => (
                  <div key={c.code} className="country-badge">
                    <span>{getFlagEmoji(c.code)}</span> {c.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {route.length > 0 && (
            <button className="export-pdf-btn no-print" onClick={handlePrint} style={{ marginTop: '16px' }}>
              📄 Export Route PDF
            </button>
          )}
        </div>

        {/* Clean semantic wrapper to ensure PDF engine processes the page break properly */}
        <div className="print-map-wrapper">
          <div className="print-map-header">Visual Route Map</div>
          <div id="map-container-zone" ref={mapRef} style={{ height: '100%', width: '100%' }} />
        </div>
      </div>
    </div>
  );
}

