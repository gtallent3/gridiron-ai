export function BookmarkletClickDemo() {
  return (
    <div className="relative w-full h-56 bg-card rounded-lg border border-border overflow-hidden">
      {/* Browser-like bookmarks bar */}
      <div className="absolute top-0 left-0 right-0 h-10 bg-muted/80 border-b border-border flex items-center px-4 gap-2">
        <div className="w-12 h-6 bg-muted/50 border border-border/50 rounded"></div>
        <div className="w-12 h-6 bg-muted/50 border border-border/50 rounded"></div>
        {/* The bookmarklet */}
        <div className="px-3 py-1 bg-primary/20 border border-primary/50 rounded text-xs font-medium text-primary animate-bookmarklet-pulse">
          📋 Get ESPN Cookies
        </div>
        <div className="flex-1"></div>
      </div>

      {/* ESPN Page Mock */}
      <div className="absolute top-10 left-0 right-0 bottom-0 bg-background/50 p-4 space-y-3">
        {/* Address bar showing ESPN URL */}
        <div className="bg-muted/50 border border-border rounded px-3 py-2 text-xs text-muted-foreground font-mono flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary/50"></div>
          <span className="text-primary">fantasy.espn.com</span>
          <span>/football/league?leagueId=</span>
          <span className="text-primary font-semibold">123456</span>
        </div>

        {/* ESPN Content Mock */}
        <div className="space-y-2">
          <div className="bg-red-500/10 border border-red-500/30 rounded p-2 flex items-center gap-2">
            <div className="w-8 h-8 bg-red-500/20 rounded flex items-center justify-center text-red-500 font-bold text-sm">E</div>
            <div className="flex-1">
              <div className="h-3 bg-muted/50 rounded w-32 mb-1"></div>
              <div className="h-2 bg-muted/30 rounded w-24"></div>
            </div>
          </div>
          <div className="h-16 bg-muted/30 rounded"></div>
        </div>

        {/* Success Message */}
        <div className="absolute inset-x-4 bottom-4 bg-primary/20 border border-primary rounded p-3 animate-success-slide opacity-0">
          <div className="flex items-center gap-2 text-primary text-sm font-medium">
            <div className="text-lg">✓</div>
            <span>Cookies captured! Return to GridironGM</span>
          </div>
        </div>
      </div>

      {/* Animated cursor clicking bookmarklet */}
      <div className="absolute animate-cursor-click">
        <div className="text-4xl select-none drop-shadow-lg">👆</div>
      </div>

      {/* Click indicator */}
      <div className="absolute animate-click-ripple opacity-0">
        <div className="w-12 h-12 rounded-full border-4 border-primary"></div>
      </div>

      <style>{`
        @keyframes bookmarklet-pulse {
          0%, 50%, 100% {
            box-shadow: 0 0 0 0 rgba(142, 186, 111, 0);
          }
          25% {
            box-shadow: 0 0 0 4px rgba(142, 186, 111, 0.4);
          }
        }

        @keyframes cursor-click {
          0%, 15% {
            top: 50%;
            left: 50%;
            opacity: 0;
          }
          20%, 35% {
            top: 2.5%;
            left: 35%;
            opacity: 1;
          }
          40% {
            top: 2%;
            left: 35%;
            opacity: 1;
          }
          45%, 100% {
            top: 2%;
            left: 35%;
            opacity: 0;
          }
        }

        @keyframes click-ripple {
          0%, 39% {
            top: 2.5%;
            left: 35%;
            opacity: 0;
            transform: scale(0.5);
          }
          40% {
            top: 2.5%;
            left: 35%;
            opacity: 1;
            transform: scale(0.5);
          }
          50% {
            opacity: 0.6;
            transform: scale(1.2);
          }
          60%, 100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }

        @keyframes success-slide {
          0%, 60% {
            opacity: 0;
            transform: translateY(20px);
          }
          65% {
            opacity: 1;
            transform: translateY(0);
          }
          85% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(0);
          }
        }

        .animate-bookmarklet-pulse {
          animation: bookmarklet-pulse 4s ease-in-out infinite;
        }

        .animate-cursor-click {
          animation: cursor-click 4s ease-in-out infinite;
        }

        .animate-click-ripple {
          animation: click-ripple 4s ease-in-out infinite;
        }

        .animate-success-slide {
          animation: success-slide 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
