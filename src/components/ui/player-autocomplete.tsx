import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Player {
  player_id: string;
  player_name: string;
  team: string;
  position: string;
}

interface PlayerAutocompleteProps {
  value?: string;
  onSelectPlayer: (player: Player) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function PlayerAutocomplete({
  value,
  onSelectPlayer,
  placeholder = 'Search player...',
  className,
  disabled,
}: PlayerAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Player[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data, error} = await supabase
          .from('player_rankings')
          .select('player_id, player_name, team, position')
          .eq('season', 2025)
          .or(`player_name.ilike.%${query}%`)
          .order('trade_value', { ascending: false })
          .limit(50);

        if (error) throw error;
        
        // Remove duplicates by player_id
        const uniquePlayers = data?.reduce((acc: Player[], current) => {
          const exists = acc.find(p => p.player_id === current.player_id);
          if (!exists) {
            acc.push(current);
          }
          return acc;
        }, []).slice(0, 10) || [];
        
        setResults(uniquePlayers);
        setIsOpen(true);
        setSelectedIndex(-1);
      } catch (error) {
        console.error('Search error:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = useCallback((player: Player) => {
    onSelectPlayer(player);
    setQuery(player.player_name);
    setIsOpen(false);
    setSelectedIndex(-1);
  }, [onSelectPlayer]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < results.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : results.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setIsOpen(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-10 pr-10"
        />
        {query && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-[300px] overflow-y-auto"
          role="listbox"
        >
          {results.map((player, index) => (
            <button
              key={player.player_id}
              type="button"
              onClick={() => handleSelect(player)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'w-full px-4 py-3 text-left hover:bg-accent transition-colors',
                'flex items-center justify-between gap-2',
                index === selectedIndex && 'bg-accent',
                'border-b last:border-b-0'
              )}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{player.player_name}</div>
                <div className="text-xs text-muted-foreground">
                  {player.team} • {player.position}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {isOpen && query.length >= 2 && results.length === 0 && !loading && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-background border rounded-lg shadow-lg p-4 text-center text-sm text-muted-foreground"
        >
          No results — try full name
        </div>
      )}
    </div>
  );
}
