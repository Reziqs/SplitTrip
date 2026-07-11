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
        top: `${rect.bottom + 6}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        zIndex: 99999
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
              {mode.icon} {mode.label}
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
  const lineRef = useRef(null);
  const midMarkersRef = useRef([]); // Track map icon markers to safely clear/re-render them

  useEffect(() => {
    if (!mapInstance.current) {
      mapInstance.current = L.map(mapRef.current, { zoomControl: false }).setView([52.3555, -1.1743], 6);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(mapInstance.current);
      L.control.zoom({ position: 'bottomright' }).addTo(mapInstance.current);

      mapInstance.current.on('click', (e) => {
        const { lat, lng } = e.latlng;
        
        setPending({ 
          lat, 
          lng, 
          name: "Loading location...", 
          x: e.containerPoint.x, 
          y: e.containerPoint.y 
        });

        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
          .then(res => res.json())
          .then(data => {
            const townName = data.address?.town || data.address?.city || data.address?.village || "Wayward Point";
            setPending(prev => prev ? { ...prev, name: townName } : null);
          })
          .catch(() => {
            setPending(prev => prev ? { ...prev, name: "Wayward Point" } : null);
          });
      });
    }
  }, []);

  const removePoint = (index) => {
    setDeletingIndex(index);
    setTimeout(() => {
      const p = route[index];
      if (p.marker) mapInstance.current.removeLayer(p.marker);
      setRoute(prevRoute => prevRoute.filter((_, i) => i !== index));
      setDeletingIndex(null);
    }, 300);
  };

  // Syncs polyline segments and mid-route method markers together dynamically
  useEffect(() => {
    // 1. Clear previous lines
    if (lineRef.current) lineRef.current.remove();
    
    // 2. Clear old midpoint icons from the map canvas
    midMarkersRef.current.forEach(m => m.remove());
    midMarkersRef.current = [];

    if (route.length > 1) {
      // Draw the main orange line path
      lineRef.current = L.polyline(route.map(p => [p.lat, p.lng]), { 
        color: '#f97316', 
        weight: 5, 
        smoothFactor: 1 
      }).addTo(mapInstance.current);

      // 3. Loop paths to calculate geometric midpoints between each sequential point pair
      for (let i = 0; i < route.length - 1; i++) {
        const start = route[i];
        const end = route[i + 1];
        
        // Find center coordinates
        const midLat = (start.lat + end.lat) / 2;
        const midLng = (start.lng + end.lng) / 2;
        
        // Match transport icon mapping logic
        const targetMode = MODES.find(m => m.id === (end.mode || 'train'));

        // Create custom floating structural wrapper inside Leaflet map container layer
        const midIcon = L.divIcon({
          html: `<div class="map-midpoint-badge">${targetMode?.icon || '🚂'}</div>`,
          className: 'custom-div-icon-reset', // Reset standard default styling sheets
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });

        // Add the midpoint marker pin layer to the map
        const midMarker = L.marker([midLat, midLng], { icon: midIcon }).addTo(mapInstance.current);
        midMarkersRef.current.push(midMarker);
      }
    }
  }, [route]);

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="app-container">
      <style>{`
        .app-container { display: flex; flex-direction: column; height: 100vh; width: 100vw; overflow: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        
        .top-navbar { height: 70px; width: 100%; background: #ffffff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; padding: 0 24px; box-sizing: border-box; z-index: 1010; box-shadow: 0 2px 10px rgba(0,0,0,0.02); }
        .brand-logo { height: 42px; object-fit: contain; mix-blend-mode: multiply; }
        
        .view-body { flex: 1; width: 100%; position: relative; }
        
        .popout-panel { position: absolute; top: 20px; left: 20px; width: 320px; max-height: 80vh; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-radius: 24px; box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12); z-index: 1000; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.8); box-sizing: border-box; display: flex; flex-direction: column; }
        .panel-title { font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 20px 0; letter-spacing: -0.025em; }
        .empty-state { color: #64748b; font-size: 14px; margin: 0; }
        
        .panel-scroll-content { flex: 1; overflow-y: auto; overflow-x: visible; padding-right: 4px; margin-right: -4px; margin-bottom: 16px; }
        
        .waypoint-leg-container { width: 100%; display: flex; flex-direction: column; transform: translateX(0); opacity: 1; max-height: 200px; }
        .waypoint-leg-container.slide-out { animation: slideLeft 0.3s forwards cubic-bezier(0.4, 0, 0.2, 1); }
        
        .stop-card { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #f8fafc; border: 1px solid #f1f5f9; box-sizing: border-box; border-radius: 16px; width: 100%; }
        .stop-info-group { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
        .stop-name { font-size: 14px; font-weight: 500; color: #334155; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        
        .delete-btn { border: none; background: #fee2e2; color: #ef4444; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; font-weight: bold; font-size: 12px; padding: 0; line-height: 1; transition: background 0.2s; flex-shrink: 0; margin-left: 10px; }
        .delete-btn:hover { background: #fca5a5; }

        /* Midpoint map badge element design rules */
        .custom-div-icon-reset { background: none; border: none; }
        .map-midpoint-badge { display: flex; align-items: center; justify-content: center; font-size: 16px; background: #ffffff; width: 30px; height: 30px; border-radius: 50%; border: 2.5px solid #f97316; box-shadow: 0 4px 10px rgba(0,0,0,0.15); font-family: system-ui, sans-serif; pointer-events: none; }
        
        .print-mode-text { display: none; text-align: center; color: #475569; font-weight: 600; font-size: 13px; margin: 8px 0; }
        .print-header-logo { display: none; margin-bottom: 24px; text-align: left; }

        @keyframes slideLeft {
          0% { transform: translateX(0); opacity: 1; max-height: 200px; }
          100% { transform: translateX(-105%); opacity: 0; max-height: 0; padding: 0; margin: 0; overflow: hidden; }
        }

        .custom-dropdown-container { position: relative; width: 100%; display: flex; justify-content: center; margin: 12px 0; }
        .dropdown-trigger { display: flex; justify-content: space-between; align-items: center; width: 160px; padding: 10px 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; font-size: 14px; font-weight: 500; color: #334155; cursor: pointer; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.03); transition: all 0.2s; box-sizing: border-box; }
        .dropdown-trigger:hover { border-color: #cbd5e1; background: #f8fafc; }
        .dropdown-trigger.open { border-color: #94a3b8; box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.15); }
        .dropdown-arrow { font-size: 10px; color: #94a3b8; }
        
        .dropdown-menu-panel { background: #ffffff; border-radius: 14px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.12); border: 1px solid #e2e8f0; padding: 6px; box-sizing: border-box; z-index: 99999; animation: fadeInDropdown 0.15s ease-out; }
        .dropdown-menu-item { padding: 10px 14px; font-size: 14px; font-weight: 500; color: #475569; border-radius: 10px; cursor: pointer; transition: background 0.15s; text-align: left; }
        .dropdown-menu-item:hover { background: #f1f5f9; color: #0f172a; }
        .dropdown-menu-item.selected { background: #f1f5f9; color: #0f172a; font-weight: 600; }
        
        .export-pdf-btn { width: 100%; padding: 12px; background: #0f172a; color: white; border: none; border-radius: 14px; font-weight: 600; font-size: 14px; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .export-pdf-btn:hover { background: #1e293b; }

        @keyframes fadeInDropdown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .confirm-btn-bubble { position: absolute; background: #22c55e; color: white; border: none; width: 44px; height: 44px; border-radius: 50%; box-shadow: 0 12px 24px rgba(34, 197, 94, 0.35); z-index: 1200; cursor: pointer; display: flex; align-items: center; justify-content: center; transform: scale(1); transition: transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .confirm-btn-bubble:hover { transform: scale(1.1); background: #16a34a; }
        .modern-tick { font-family: system-ui, -apple-system, sans-serif; font-size: 22px; font-weight: 800; line-height: 1; margin-top: -2px; }

        @media print {
          body, html, .app-container { height: auto !important; overflow: visible !important; background: white !important; }
          .top-navbar, #map-container-zone, .leaflet-control-container, .confirm-btn-bubble, .no-print, .delete-btn { 
            display: none !important; 
          }
          .print-header-logo { display: block !important; }
          .popout-panel { position: relative !important; top: 0 !important; left: 0 !important; width: 100% !important; max-height: none !important; box-shadow: none !important; border: none !important; background: transparent !important; padding: 0 !important; overflow: visible !important; }
          .panel-scroll-content { overflow: visible !important; }
          .stop-card { background: #ffffff !important; border: 1px solid #cbd5e1 !important; page-break-inside: avoid; }
          .print-mode-text { display: block !important; }
        }
      `}</style>

      <header className="top-navbar no-print">
        <img src={LOGO_URL} alt="Split Trip Logo" className="brand-logo" />
      </header>

      <div className="view-body">
        <div className="popout-panel">
          <div className="print-header-logo">
            <img src={LOGO_URL} alt="Split Trip Logo" className="brand-logo" />
          </div>

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

          {route.length > 0 && (
            <button className="export-pdf-btn no-print" onClick={handleExportPDF}>
              📄 Export Route PDF
            </button>
          )}
        </div>

        <div id="map-container-zone" ref={mapRef} style={{ height: '100%', width: '100%' }} />

        {pending && (
          <button 
            className="confirm-btn-bubble"
            style={{ 
              top: pending.y - 45, 
              left: pending.x - 22 
            }} 
            onClick={() => { 
              const marker = L.marker([pending.lat, pending.lng]).addTo(mapInstance.current);
              setRoute([...route, { ...pending, marker, id: Date.now(), mode: 'train' }]);
              setPending(null);
            }}
          >
            <span className="modern-tick">✓</span>
          </button>
        )}
      </div>
    </div>
  );
}