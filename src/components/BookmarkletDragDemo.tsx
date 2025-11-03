export function BookmarkletDragDemo() {
  return (
    <div className="space-y-2">
      {/* Keyboard shortcut instructions */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded border border-border">
        <span>Show bookmarks bar:</span>
        <kbd className="px-2 py-1 bg-card border border-border rounded text-foreground font-mono">Ctrl+Shift+B</kbd>
        <span className="text-muted-foreground/50">or</span>
        <kbd className="px-2 py-1 bg-card border border-border rounded text-foreground font-mono">Cmd+Shift+B</kbd>
      </div>

      <div className="relative w-full h-48 bg-card rounded-lg border border-border overflow-hidden">
        {/* Browser-like bookmarks bar */}
        <div className="absolute top-0 left-0 right-0 h-10 bg-muted/80 border-b border-border flex items-center px-4 gap-2">
          <div className="w-16 h-6 bg-card border border-border rounded text-xs flex items-center justify-center text-muted-foreground">
            ⭐ Bookmarks
          </div>
          <div className="w-12 h-6 bg-muted/50 border border-border/50 rounded"></div>
          <div className="w-12 h-6 bg-muted/50 border border-border/50 rounded"></div>
          <div className="flex-1"></div>
          <div className="text-xs text-primary animate-pulse font-medium">← Drop here</div>
        </div>

        {/* Bookmarklet button that animates */}
        <div className="absolute left-1/2 -translate-x-1/2 animate-drag-up">
          <div className="px-4 py-2 bg-primary text-primary-foreground rounded-md shadow-[0_0_20px_rgba(142,186,111,0.4)] font-medium text-sm whitespace-nowrap border border-primary/50">
            📋 Get ESPN Cookies
          </div>
        </div>

        {/* Animated cursor/hand */}
        <div className="absolute left-1/2 -translate-x-1/2 animate-drag-cursor">
          <div className="text-4xl select-none drop-shadow-lg">👆</div>
        </div>

        {/* Motion trail effect */}
        <div className="absolute left-1/2 -translate-x-1/2 animate-drag-trail opacity-40">
          <div className="w-1 h-24 bg-gradient-to-b from-primary via-primary/50 to-transparent rounded-full"></div>
        </div>

        <style>{`
          @keyframes drag-up {
            0%, 20% {
              top: 60%;
              opacity: 1;
              transform: translateX(-50%) scale(1);
            }
            70% {
              top: 10%;
              opacity: 1;
              transform: translateX(-50%) scale(0.95);
            }
            85% {
              top: 10%;
              opacity: 0.5;
              transform: translateX(-50%) scale(0.9);
            }
            100% {
              top: 10%;
              opacity: 0;
              transform: translateX(-50%) scale(0.85);
            }
          }

          @keyframes drag-cursor {
            0%, 20% {
              top: 65%;
              opacity: 1;
            }
            70% {
              top: 8%;
              opacity: 1;
            }
            85%, 100% {
              top: 8%;
              opacity: 0;
            }
          }

          @keyframes drag-trail {
            0%, 20% {
              top: 60%;
              opacity: 0;
            }
            40% {
              top: 40%;
              opacity: 0.3;
            }
            70% {
              top: 10%;
              opacity: 0;
            }
            100% {
              top: 10%;
              opacity: 0;
            }
          }

          .animate-drag-up {
            animation: drag-up 3s ease-in-out infinite;
          }

          .animate-drag-cursor {
            animation: drag-cursor 3s ease-in-out infinite;
          }

          .animate-drag-trail {
            animation: drag-trail 3s ease-in-out infinite;
          }
        `}</style>
      </div>
    </div>
  );
}
