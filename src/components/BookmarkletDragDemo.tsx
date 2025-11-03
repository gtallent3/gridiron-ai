export function BookmarkletDragDemo() {
  return (
    <div className="relative w-full h-48 bg-gradient-to-b from-muted/50 to-background rounded-lg border-2 border-primary/20 overflow-hidden">
      {/* Browser-like bookmarks bar */}
      <div className="absolute top-0 left-0 right-0 h-10 bg-muted border-b flex items-center px-4 gap-2">
        <div className="w-16 h-6 bg-background/50 rounded text-xs flex items-center justify-center">
          ⭐ Bookmarks
        </div>
        <div className="w-12 h-6 bg-background/30 rounded"></div>
        <div className="w-12 h-6 bg-background/30 rounded"></div>
        <div className="flex-1"></div>
        <div className="text-xs text-muted-foreground animate-pulse">← Drop here</div>
      </div>

      {/* Bookmarklet button that animates */}
      <div className="absolute left-1/2 -translate-x-1/2 animate-drag-up">
        <div className="px-4 py-2 bg-primary text-primary-foreground rounded-md shadow-lg font-medium text-sm whitespace-nowrap">
          📋 Get ESPN Cookies
        </div>
      </div>

      {/* Animated cursor/hand */}
      <div className="absolute left-1/2 -translate-x-1/2 animate-drag-cursor">
        <div className="text-4xl select-none">👆</div>
      </div>

      {/* Motion trail effect */}
      <div className="absolute left-1/2 -translate-x-1/2 animate-drag-trail opacity-30">
        <div className="w-1 h-20 bg-gradient-to-b from-primary to-transparent"></div>
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
  );
}