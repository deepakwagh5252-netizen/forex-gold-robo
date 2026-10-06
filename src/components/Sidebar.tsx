import React from 'react';
import { 
  LayoutDashboard, 
  ListFilter, 
  Coins, 
  Globe2, 
  Radar, 
  FlaskConical, 
  FileText, 
  BookOpen, 
  Settings2,
  Lock,
  ChevronRight
} from 'lucide-react';
import { NavigationPage } from '../types/terminal';

interface SidebarProps {
  activePage: NavigationPage;
  onSelectPage: (page: NavigationPage) => void;
}

interface NavItem {
  id: NavigationPage;
  label: string;
  icon: React.ElementType;
  isReady: boolean;
  tag?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
}) => {
  const navItems: NavItem[] = [
    {
      id: 'command_center',
      label: 'Command Center',
      icon: LayoutDashboard,
      isReady: true,
      tag: 'ACTIVE',
    },
    {
      id: 'forex_watchlist',
      label: 'Forex Watchlist',
      icon: ListFilter,
      isReady: false,
    },
    {
      id: 'xau_usd',
      label: 'XAU/USD',
      icon: Coins,
      isReady: false,
    },
    {
      id: 'market_sessions',
      label: 'Market Sessions',
      icon: Globe2,
      isReady: false,
    },
    {
      id: 'setup_scanner',
      label: 'Setup Scanner',
      icon: Radar,
      isReady: false,
    },
    {
      id: 'strategy_lab',
      label: 'Strategy Lab',
      icon: FlaskConical,
      isReady: true,
      tag: 'PHASE 7D',
    },
    {
      id: 'paper_trading',
      label: 'Paper Trading',
      icon: FileText,
      isReady: true,
      tag: 'PHASE 8',
    },
    {
      id: 'trade_journal',
      label: 'Trade Journal',
      icon: BookOpen,
      isReady: false,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings2,
      isReady: false,
    },
  ];

  return (
    <aside 
      id="terminal-sidebar"
      className="w-60 bg-[#080d16] border-r border-[#1b2537] flex flex-col justify-between shrink-0 select-none text-xs"
    >
      <div className="py-3">
        <div className="px-4 pb-2 mb-1 border-b border-[#141d2d] flex items-center justify-between">
          <span className="text-[10px] font-mono tracking-wider text-slate-500 uppercase font-semibold">
            Workstation Views
          </span>
          <span className="text-[9px] font-mono px-1.5 py-0.2 bg-[#121c2c] text-cyan-400 border border-[#1e304a]">
            PHASE 1
          </span>
        </div>

        <nav className="space-y-0.5 px-2">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;

            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => onSelectPage(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors font-mono text-[11px] group ${
                  isActive
                    ? 'bg-[#152033] text-cyan-300 border-l-2 border-cyan-400 font-semibold shadow-inner'
                    : item.isReady
                    ? 'text-slate-300 hover:bg-[#0f1725] hover:text-slate-100 border-l-2 border-transparent'
                    : 'text-slate-400 hover:bg-[#0d1420] hover:text-slate-200 border-l-2 border-transparent'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <span className="text-[10px] text-slate-600 font-mono w-3.5 text-right">
                    {index + 1}
                  </span>
                  <Icon 
                    className={`w-4 h-4 shrink-0 ${
                      isActive 
                        ? 'text-cyan-400' 
                        : item.isReady 
                        ? 'text-slate-400 group-hover:text-slate-200' 
                        : 'text-slate-500 group-hover:text-slate-400'
                    }`} 
                  />
                  <span className="truncate">{item.label}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  {item.tag && (
                    <span className="text-[9px] font-mono px-1.5 py-0.2 bg-cyan-950/80 border border-cyan-800 text-cyan-400">
                      {item.tag}
                    </span>
                  )}
                  {!item.isReady && (
                    <span className="text-[8px] font-mono px-1 py-0.5 bg-[#121620] border border-[#202737] text-slate-500 group-hover:text-slate-400">
                      NEXT
                    </span>
                  )}
                  {isActive && <ChevronRight className="w-3 h-3 text-cyan-400" />}
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Terminal Footer Info */}
      <div className="p-3 border-t border-[#141d2d] bg-[#060a12] space-y-2">
        <div className="bg-[#0b111c] p-2 border border-[#1a2538] text-[10px] font-mono space-y-1">
          <div className="flex items-center justify-between text-slate-400">
            <span>Provider Engine:</span>
            <span className="text-amber-400 font-semibold">STANDBY</span>
          </div>
          <div className="flex items-center justify-between text-slate-500">
            <span>Verified Source:</span>
            <span className="text-slate-400">Phase 2 Feed</span>
          </div>
          <div className="flex items-center justify-between text-slate-500">
            <span>Data Integrity:</span>
            <span className="text-emerald-400">100% Uncompromised</span>
          </div>
        </div>

        <div className="text-[9px] font-mono text-slate-600 px-1 flex items-center justify-between">
          <span>FOREX &amp; GOLD ROBO</span>
          <span>BUILD 1.0</span>
        </div>
      </div>
    </aside>
  );
};
