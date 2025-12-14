import React, { useEffect, useState, useMemo, useRef } from 'react';

// --- STYLES & FONTS INJECTION ---
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
    
    /* Custom Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
    
    .dark ::-webkit-scrollbar-thumb { background: #4b5563; }
    .dark ::-webkit-scrollbar-thumb:hover { background: #6b7280; }
    
    .pixel ::-webkit-scrollbar { width: 12px; height: 12px; }
    .pixel ::-webkit-scrollbar-thumb { background: #4ade80; border-radius: 0; border: 2px solid #0f172a; }
    .pixel ::-webkit-scrollbar-track { background: #0f172a; border-left: 2px solid #4ade80; }
  `}</style>
);

// --- TYPES ---
export interface BinanceStreamMessage {
  stream: string;
  data: BinanceTickerWS[] | BinanceTickerWS;
}

export interface BinanceTickerWS {
  s: string; c: string; v: string; q: string; P: string; e?: string;
}

export interface TickerData {
  symbol: string;
  price: number;
  volume: number;
  changePercent1h?: number;
  changePercent4h?: number;
  changePercent24h: number;
}

export type SortField = 'symbol' | 'price' | 'volume' | 'change1h' | 'change4h' | 'change24h';
export type SortDirection = 'asc' | 'desc';
export type ThemeMode = 'light' | 'dark' | 'pixel';

// --- THEME CONFIGURATION ---
const THEMES = {
  light: {
    id: 'light',
    name: 'Light',
    bg: 'bg-gray-50',
    card: 'bg-white',
    textMain: 'text-gray-700',
    textSub: 'text-gray-500',
    border: 'border-gray-200',
    headerBg: 'bg-white/90 backdrop-blur-md',
    radius: 'rounded-lg',
    font: 'font-sans',
    iconMain: 'text-gray-700',
    button: 'bg-white hover:bg-gray-50 border-gray-300 text-gray-700',
    buttonActive: 'bg-black text-white border-black',
    accent: 'text-black',
    rowBorder: 'border-gray-100',
    rowHover: 'hover:bg-gray-50',
    loading: 'text-gray-500',
    dropdownBg: 'bg-white/95',
    shadow: 'shadow-md',
  },
  dark: {
    id: 'dark',
    name: 'Dark',
    bg: 'bg-gray-900',
    card: 'bg-gray-800',
    textMain: 'text-gray-100',
    textSub: 'text-gray-400',
    border: 'border-gray-700',
    headerBg: 'bg-gray-900/90 backdrop-blur-md',
    radius: 'rounded-lg',
    font: 'font-sans',
    iconMain: 'text-gray-200',
    button: 'bg-gray-800 hover:bg-gray-700 border-gray-600 text-gray-200',
    buttonActive: 'bg-gray-100 text-gray-900 border-gray-100',
    accent: 'text-white',
    rowBorder: 'border-gray-700',
    rowHover: 'hover:bg-gray-700',
    loading: 'text-gray-400',
    dropdownBg: 'bg-gray-800/95',
    shadow: 'shadow-xl shadow-black/50',
  },
  pixel: {
    id: 'pixel',
    name: 'Pixel',
    bg: 'bg-slate-900',
    card: 'bg-slate-900',
    textMain: 'text-green-400',
    textSub: 'text-green-600',
    border: 'border-green-500 border-b-4 border-r-4 border-t-2 border-l-2',
    headerBg: 'bg-slate-900 border-b-4 border-green-500',
    radius: 'rounded-none',
    font: "font-['Press_Start_2P'] tracking-tight text-xs",
    iconMain: 'text-green-400',
    button: 'bg-slate-900 hover:bg-green-900 border-green-600 text-green-400 border-2',
    buttonActive: 'bg-green-500 text-slate-900 border-green-500 border-2',
    accent: 'text-yellow-400',
    rowBorder: 'border-green-900 border-dashed',
    rowHover: 'hover:bg-green-900/30',
    loading: 'text-green-500 animate-pulse',
    dropdownBg: 'bg-slate-900 border-4 border-green-500',
    shadow: 'shadow-none',
  }
};

// --- SERVICE ---
const KNOWN_QUOTE_ASSETS = ['USDT', 'FDUSD', 'USDC', 'TUSD', 'BUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY'];
const getQuoteAsset = (symbol: string): string | null => {
  for (const asset of KNOWN_QUOTE_ASSETS) {
    if (symbol.endsWith(asset)) return asset;
  }
  return null;
};

class BinanceService {
  private ws: WebSocket | null = null;
  private subscribers: ((data: Map<string, TickerData>) => void)[] = [];
  private tickerMap: Map<string, TickerData> = new Map();
  private reconnectAttempt = 0;
  private endpointIndex = 0;
  private pendingFetches: Set<string> = new Set();
  
  private BASE_WS_URLS = [
    `wss://data-stream.binance.vision/stream?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr`,
    `wss://stream.binance.com:443/stream?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr`,
    `wss://stream.binance.com:9443/stream?streams=!ticker@arr/!ticker_1h@arr/!ticker_4h@arr`,
  ];

  public connect() {
    this.fetchInitialSnapshot();
    this.connectWebSocket();
  }

  private async fetchInitialSnapshot() {
    const domains = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api-gcp.binance.com'];
    for (const domain of domains) {
      try {
        const [tickerRes, infoRes] = await Promise.all([
          fetch(`${domain}/api/v3/ticker/24hr`),
          fetch(`${domain}/api/v3/exchangeInfo?permissions=SPOT`)
        ]);
        if (!tickerRes.ok || !infoRes.ok) continue;

        const tickerData = await tickerRes.json();
        const infoData = await infoRes.json();
        
        const tradingSymbols = new Set(infoData.symbols.filter((s: any) => s.status === 'TRADING').map((s: any) => s.symbol));
        
        tickerData.forEach((item: any) => {
          if (!tradingSymbols.has(item.symbol) || item.count === 0) return;
          this.tickerMap.set(item.symbol, {
            symbol: item.symbol,
            price: parseFloat(item.lastPrice),
            volume: parseFloat(item.quoteVolume),
            changePercent24h: parseFloat(item.priceChangePercent),
            changePercent1h: undefined,
            changePercent4h: undefined,
          });
        });
        this.notify();
        return;
      } catch (e) { /* continue */ }
    }
    this.notify();
  }

  public async fetchDetailedStats(symbol: string) {
    if (this.pendingFetches.has(symbol)) return;
    this.pendingFetches.add(symbol);
    try {
      const baseUrl = 'https://data-api.binance.vision/api/v3/ticker';
      const [res1h, res4h] = await Promise.all([
        fetch(`${baseUrl}?symbol=${symbol}&windowSize=1h`).then(r => r.ok ? r.json() : null),
        fetch(`${baseUrl}?symbol=${symbol}&windowSize=4h`).then(r => r.ok ? r.json() : null)
      ]);
      const item = this.tickerMap.get(symbol);
      if (item) {
        if (res1h && item.changePercent1h === undefined) item.changePercent1h = parseFloat(res1h.priceChangePercent);
        if (res4h && item.changePercent4h === undefined) item.changePercent4h = parseFloat(res4h.priceChangePercent);
        this.tickerMap.set(symbol, item);
        this.notify();
      }
    } finally {
      this.pendingFetches.delete(symbol);
    }
  }

  private connectWebSocket() {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    
    this.ws = new WebSocket(this.BASE_WS_URLS[this.endpointIndex]);
    
    this.ws.onopen = () => { this.reconnectAttempt = 0; };
    
    this.ws.onmessage = (event) => {
      try {
        const msg: BinanceStreamMessage = JSON.parse(event.data);
        if (!msg.data) return;
        const data = Array.isArray(msg.data) ? msg.data : [msg.data];
        const is1h = msg.stream.includes('1h');
        const is4h = msg.stream.includes('4h');
        
        data.forEach(item => {
          const existing = this.tickerMap.get(item.s) || { symbol: item.s, price: 0, volume: 0, changePercent24h: 0 };
          if (!is1h && !is4h) {
            existing.price = parseFloat(item.c);
            existing.volume = parseFloat(item.q);
            existing.changePercent24h = parseFloat(item.P);
          } else if (is1h) existing.changePercent1h = parseFloat(item.P);
          else if (is4h) existing.changePercent4h = parseFloat(item.P);
          this.tickerMap.set(item.s, existing);
        });
        this.notify();
      } catch (e) {}
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.endpointIndex = (this.endpointIndex + 1) % this.BASE_WS_URLS.length;
      setTimeout(() => this.connectWebSocket(), Math.min(1000 * 1.5 ** this.reconnectAttempt++, 10000));
    };
  }

  public subscribe(cb: (data: Map<string, TickerData>) => void) {
    this.subscribers.push(cb);
    if (this.tickerMap.size > 0) cb(new Map(this.tickerMap));
    return () => { this.subscribers = this.subscribers.filter(s => s !== cb); };
  }
  
  public disconnect() { this.ws?.close(); }
  private notify() { const snap = new Map(this.tickerMap); this.subscribers.forEach(cb => cb(snap)); }
}

const binanceService = new BinanceService();

// --- COMPONENTS ---

const getHeatmapColor = (pct: number | undefined, theme: ThemeMode) => {
  if (pct === undefined) return theme === 'dark' ? '#374151' : theme === 'pixel' ? 'transparent' : '#f3f4f6';
  
  if (theme === 'pixel') {
    if (pct > 0) return '#00aa00';
    if (pct < 0) return '#aa0000';
    return '#555555';
  }

  if (theme === 'dark') {
    if (pct > 30) return '#064e3b';
    if (pct > 10) return '#065f46';
    if (pct > 0) return '#042f2e';
    if (pct >= -0.01) return '#374151';
    if (pct > -10) return '#7f1d1d';
    return '#450a0a';
  }

  if (pct > 30) return '#7bbc81';
  if (pct > 20) return '#a3d1aa';
  if (pct > 10) return '#b1d9b9';
  if (pct > 5) return '#c0e0c7';
  if (pct > 0.01) return '#dfeee2';
  if (pct >= -0.01) return '#fdf3d1';
  if (pct > -5) return '#efbdc2';
  if (pct > -10) return '#e8939a';
  if (pct > -20) return '#e68085';
  return '#e46c72';
};

const VirtualTable = ({ data, favorites, onToggleFavorite, onSortedIdsChange, theme }: any) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [sortField, setSortField] = useState<SortField>('volume');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const t = THEMES[theme as ThemeMode];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => requestAnimationFrame(() => container && setScrollTop(container.scrollTop));
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, []);

  const sortedData = useMemo(() => {
    return [...data].sort((a: any, b: any) => {
      let valA = a[sortField === 'change1h' ? 'changePercent1h' : sortField === 'change4h' ? 'changePercent4h' : sortField === 'change24h' ? 'changePercent24h' : sortField] ?? 0;
      let valB = b[sortField === 'change1h' ? 'changePercent1h' : sortField === 'change4h' ? 'changePercent4h' : sortField === 'change24h' ? 'changePercent24h' : sortField] ?? 0;
      if (typeof valA === 'string') { valA = valA.toLowerCase(); valB = valB.toLowerCase(); }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortField, sortDirection]);

  useEffect(() => { onSortedIdsChange?.(sortedData.map((d: any) => d.symbol)); }, [sortedData, onSortedIdsChange]);

  const ROW_HEIGHT = theme === 'pixel' ? 56 : 50;
  const HEADER_HEIGHT = 44;
  const totalHeight = sortedData.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const visibleCount = Math.ceil((containerRef.current?.clientHeight || 600) / ROW_HEIGHT) + 20;
  const visibleData = sortedData.slice(startIndex, startIndex + visibleCount);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDirection('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className={`ml-1 ${sortField !== field ? 'opacity-0' : ''}`}>{sortDirection === 'asc' ? '↑' : '↓'}</span>
  );

  return (
    <div className={`flex flex-col border ${t.border} ${t.radius} overflow-hidden ${t.card} ${t.shadow} w-full h-full ${t.font}`}>
      {/* Table Header */}
      <div className={`flex items-center ${t.bg} border-b ${t.border} text-[10px] sm:text-xs font-semibold uppercase tracking-wider ${t.textSub} flex-shrink-0 z-10`} style={{ height: HEADER_HEIGHT }}>
        <div className="w-8 sm:w-10 flex-shrink-0"></div>
        <button className="flex-1 px-1 sm:px-2 text-left h-full flex items-center hover:opacity-80" onClick={() => handleSort('symbol')}>Token<SortIcon field="symbol" /></button>
        <button className="w-20 sm:w-32 px-1 sm:px-2 text-right h-full flex items-center justify-end hover:opacity-80" onClick={() => handleSort('price')}>Price<SortIcon field="price" /></button>
        <button className="hidden sm:flex w-24 md:w-36 lg:w-40 px-2 text-right h-full items-center justify-end hover:opacity-80" onClick={() => handleSort('volume')}>Vol<span className="hidden md:inline">(24h)</span><SortIcon field="volume" /></button>
        <button className="hidden lg:flex w-20 px-2 text-right h-full items-center justify-end hover:opacity-80" onClick={() => handleSort('change1h')}>1h<SortIcon field="change1h" /></button>
        <button className="hidden xl:flex w-20 px-2 text-right h-full items-center justify-end hover:opacity-80" onClick={() => handleSort('change4h')}>4h<SortIcon field="change4h" /></button>
        <button className="w-16 sm:w-24 px-1 sm:px-2 text-right h-full flex items-center justify-end hover:opacity-80" onClick={() => handleSort('change24h')}>24h<SortIcon field="change24h" /></button>
      </div>

      {/* Table Body */}
      <div ref={containerRef} className={`flex-1 overflow-y-auto relative custom-scrollbar ${theme === 'pixel' ? 'pixel' : theme === 'dark' ? 'dark' : ''}`}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleData.map((item: any, index: number) => {
            const quoteAsset = getQuoteAsset(item.symbol);
            const baseAsset = quoteAsset ? item.symbol.substring(0, item.symbol.length - quoteAsset.length) : item.symbol;
            const displayQuote = quoteAsset ? `/${quoteAsset}` : '';
            const isFav = favorites.has(item.symbol);

            return (
              <div
                key={item.symbol}
                className={`absolute top-0 left-0 w-full flex items-center border-b ${t.rowBorder} ${t.rowHover} transition-colors group`}
                style={{ height: ROW_HEIGHT, transform: `translateY(${(startIndex + index) * ROW_HEIGHT}px)` }}
              >
                <div className="w-8 sm:w-10 flex items-center justify-center h-full flex-shrink-0 cursor-pointer z-10" onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.symbol); }}>
                  <span className={`text-sm ${isFav ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}`}>★</span>
                </div>
                
                <div className={`flex-1 px-1 sm:px-2 flex items-center min-w-0 h-full ${t.textMain}`}>
                  <span className="font-bold text-xs sm:text-sm truncate">{baseAsset}</span>
                  <span className={`text-[10px] ml-0.5 ${t.textSub} hidden sm:inline opacity-70`}>{displayQuote}</span>
                </div>
                
                <div className={`w-20 sm:w-32 px-1 sm:px-2 text-right font-mono text-xs sm:text-sm h-full flex items-center justify-end ${t.textMain}`}>
                  {item.price < 1 ? item.price.toFixed(6) : item.price.toFixed(2)}
                </div>
                
                <div className={`hidden sm:flex w-24 md:w-36 lg:w-40 px-2 text-right font-mono text-xs h-full items-center justify-end ${t.textSub}`}>
                  {Number(item.volume).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                
                <div className={`hidden lg:flex w-20 px-2 h-full items-center justify-end font-mono text-xs`} 
                     style={{ color: theme === 'pixel' ? (item.changePercent1h > 0 ? '#00aa00' : '#aa0000') : (item.changePercent1h > 0 ? '#10b981' : '#ef4444') }}>
                   {item.changePercent1h ? `${item.changePercent1h > 0 ? '+' : ''}${item.changePercent1h.toFixed(2)}%` : '-'}
                </div>
                
                <div className={`hidden xl:flex w-20 px-2 h-full items-center justify-end font-mono text-xs`}
                     style={{ color: theme === 'pixel' ? (item.changePercent4h > 0 ? '#00aa00' : '#aa0000') : (item.changePercent4h > 0 ? '#10b981' : '#ef4444') }}>
                   {item.changePercent4h ? `${item.changePercent4h > 0 ? '+' : ''}${item.changePercent4h.toFixed(2)}%` : '-'}
                </div>

                <div className="w-16 sm:w-24 px-1 sm:px-2 h-full flex items-center justify-end">
                   <div className="w-full py-1 text-center rounded font-mono text-[10px] sm:text-xs font-bold"
                     style={{ 
                       backgroundColor: getHeatmapColor(item.changePercent24h, theme as ThemeMode),
                       color: theme === 'pixel' ? '#000' : (theme === 'dark' ? '#f3f4f6' : '#1f2937')
                     }}
                   >
                     {item.changePercent24h > 0 ? '+' : ''}{item.changePercent24h.toFixed(2)}%
                   </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP ---
const App = () => {
  const [tickerDataMap, setTickerDataMap] = useState<Map<string, TickerData>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['USDT']);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'market' | 'favorites'>('market');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sortedSymbols, setSortedSymbols] = useState<string[]>([]);
  const [theme, setTheme] = useState<ThemeMode>('light');
  
  const t = THEMES[theme];
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('binance_favorites');
    if (saved) try { setFavorites(new Set(JSON.parse(saved))); } catch (e) {}
    
    binanceService.connect();
    const sub = binanceService.subscribe((data) => {
      setTickerDataMap(data);
      if (data.size > 0) setIsLoading(false);
    });
    const timeout = setTimeout(() => setIsLoading(false), 10000);
    const clickOut = (e: MouseEvent) => filterRef.current && !filterRef.current.contains(e.target as Node) && setIsFilterOpen(false);
    document.addEventListener('mousedown', clickOut);
    
    return () => { clearTimeout(timeout); sub(); binanceService.disconnect(); document.removeEventListener('mousedown', clickOut); };
  }, []);

  useEffect(() => {
    localStorage.setItem('binance_favorites', JSON.stringify(Array.from(favorites)));
  }, [favorites]);

  useEffect(() => {
    if (!sortedSymbols.length) return;
    const interval = setInterval(() => {
      const target = sortedSymbols.find(s => {
        const item = tickerDataMap.get(s);
        return item && (item.changePercent1h === undefined || item.changePercent4h === undefined);
      });
      if (target) binanceService.fetchDetailedStats(target);
    }, 200);
    return () => clearInterval(interval);
  }, [sortedSymbols, tickerDataMap]);

  const { availableQuoteAssets, assetCounts } = useMemo(() => {
    const counts: Record<string, number> = { 'ALL': tickerDataMap.size };
    const assets = new Set<string>();
    tickerDataMap.forEach(item => {
      const q = getQuoteAsset(item.symbol);
      if (q) { assets.add(q); counts[q] = (counts[q] || 0) + 1; }
    });
    const priority = ['USDT', 'FDUSD', 'USDC', 'BTC', 'BNB', 'ETH'];
    return { 
      availableQuoteAssets: ['ALL', ...Array.from(assets).sort((a, b) => {
        const pA = priority.indexOf(a), pB = priority.indexOf(b);
        return (pA !== -1 && pB !== -1) ? pA - pB : (pA !== -1 ? -1 : (pB !== -1 ? 1 : a.localeCompare(b)));
      })],
      assetCounts: counts 
    };
  }, [tickerDataMap]);

  const filteredData = useMemo(() => {
    let data = Array.from(tickerDataMap.values());
    if (viewMode === 'favorites') data = data.filter(i => favorites.has(i.symbol));
    if (!selectedAssets.includes('ALL')) data = data.filter(i => selectedAssets.some(a => i.symbol.endsWith(a)));
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      data = data.filter(i => i.symbol.includes(q));
    }
    return data;
  }, [tickerDataMap, selectedAssets, searchQuery, viewMode, favorites]);

  const toggleTheme = () => {
    const cycle: ThemeMode[] = ['light', 'dark', 'pixel'];
    setTheme(cycle[(cycle.indexOf(theme) + 1) % cycle.length]);
  };

  return (
    // Use 100dvh for better mobile browser support (address bar handling)
    <div className={`h-[100dvh] w-full flex flex-col items-center transition-colors duration-300 ${t.bg} ${t.font} overflow-hidden`}>
      <GlobalStyles />
      
      {/* Header - Fixed Height */}
      <header className={`w-full flex-shrink-0 ${t.headerBg} border-b ${t.border} z-20`}>
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 sm:h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3">
             <h1 className={`text-sm sm:text-xl font-bold tracking-tight ${t.textMain} truncate`}>
               {theme === 'pixel' ? 'MARKET_V1' : 'Binance Spot'}
             </h1>
          </div>
          
          <div className="flex items-center space-x-2 sm:space-x-4">
             <button onClick={toggleTheme} className={`px-2 py-1 text-[10px] sm:text-xs font-bold uppercase rounded border transition-all ${t.button}`}>
               {theme === 'pixel' ? '[THEME]' : t.name}
             </button>

             <div className={`flex items-center space-x-1 sm:space-x-2 text-[10px] sm:text-xs font-bold ${t.textSub}`}>
                <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isLoading ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`}></span>
                <span className="hidden sm:inline">{isLoading ? 'SYNCING' : 'LIVE'}</span>
             </div>
          </div>
        </div>
      </header>

      {/* Main Content - Flex Grow to fill remaining space */}
      <main className="w-full max-w-7xl mx-auto px-2 sm:px-4 py-2 sm:py-4 flex-1 flex flex-col min-h-0">
        
        {/* Controls Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-3 gap-2 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto pb-1 md:pb-0 scrollbar-hide">
            <div className={`flex p-1 ${t.border} ${theme === 'pixel' ? 'bg-black border-2' : 'bg-gray-100 rounded-lg border'} flex-shrink-0`}>
              <button onClick={() => setViewMode('market')} className={`px-3 py-1 text-xs sm:text-sm font-medium transition-all ${viewMode === 'market' ? t.buttonActive : 'text-gray-500 hover:text-gray-700'} ${t.radius}`}>Market</button>
              <button onClick={() => setViewMode('favorites')} className={`px-3 py-1 text-xs sm:text-sm font-medium transition-all ${viewMode === 'favorites' ? t.buttonActive : 'text-gray-500 hover:text-gray-700'} ${t.radius}`}>Favorites</button>
            </div>
            <div className={`hidden md:flex items-center text-xs ${t.textSub}`}>
              <span>Count: {filteredData.length}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:flex-none md:w-40" ref={filterRef}>
              <button onClick={() => setIsFilterOpen(!isFilterOpen)} className={`flex items-center justify-between w-full px-3 py-1.5 sm:py-2 border ${t.border} ${t.radius} text-xs sm:text-sm transition-all ${isFilterOpen ? t.bg : t.button} ${t.textMain}`}>
                <span className="truncate">{selectedAssets.includes('ALL') ? 'All' : selectedAssets.join(', ')}</span>
                <span className="ml-2">▼</span>
              </button>
              {isFilterOpen && (
                <div className={`absolute top-full left-0 md:left-auto md:right-0 mt-2 w-[80vw] md:w-[400px] ${t.dropdownBg} backdrop-blur-xl border ${t.border} ${t.radius} shadow-2xl z-50 overflow-hidden flex flex-col max-h-[50vh]`}>
                  <div className={`p-3 overflow-y-auto custom-scrollbar grid grid-cols-3 sm:grid-cols-4 gap-2`}>
                    {availableQuoteAssets.map((asset) => (
                       <button key={asset} onClick={() => setSelectedAssets(prev => asset === 'ALL' ? ['ALL'] : prev.includes('ALL') ? [asset] : prev.includes(asset) ? (prev.length === 1 ? ['ALL'] : prev.filter(a => a !== asset)) : [...prev, asset])} 
                         className={`flex flex-col items-center justify-center p-2 border ${t.radius} text-[10px] sm:text-xs transition-all ${selectedAssets.includes(asset) ? t.buttonActive : t.button}`}>
                         <span className="font-bold">{asset}</span>
                       </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <input 
              type="text" 
              className={`block w-full md:w-56 px-3 py-1.5 sm:py-2 text-xs sm:text-sm border ${t.border} ${t.radius} ${t.bg} ${t.textMain} placeholder-gray-500 focus:outline-none`}
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Table Container - Flex 1 to fill height */}
        <div className="flex-1 w-full relative min-h-0">
          {isLoading && tickerDataMap.size === 0 ? (
            <div className={`absolute inset-0 flex items-center justify-center ${t.card} z-10 ${t.radius} border ${t.border}`}>
               <div className={`flex flex-col items-center ${t.loading}`}>
                 <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-current mb-2"></div>
                 <span className="text-xs sm:text-sm">Connecting...</span>
               </div>
            </div>
          ) : filteredData.length > 0 ? (
            <VirtualTable data={filteredData} favorites={favorites} onToggleFavorite={(s: string) => setFavorites(prev => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; })} onSortedIdsChange={setSortedSymbols} theme={theme} />
          ) : (
             <div className={`absolute inset-0 flex flex-col items-center justify-center ${t.textSub} ${t.card} border ${t.border} ${t.radius}`}>
               <p className="text-sm sm:text-lg font-medium">No Data Found</p>
             </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
