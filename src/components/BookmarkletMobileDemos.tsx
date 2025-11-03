export function BookmarkletCopyDemo() {
  return (
    <div className="relative w-full h-56 bg-card rounded-lg border border-border overflow-hidden">
      {/* Mobile browser mock */}
      <div className="absolute inset-0 flex flex-col">
        {/* Mobile browser header */}
        <div className="h-12 bg-muted/80 border-b border-border flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/20"></div>
            <span className="text-xs text-muted-foreground">Browser</span>
          </div>
          <div className="text-xs text-muted-foreground">📱</div>
        </div>

        {/* Dialog/Modal showing bookmarklet code */}
        <div className="flex-1 bg-background/50 p-4 flex items-center justify-center">
          <div className="bg-card border border-border rounded-lg p-4 w-full max-w-sm space-y-3 animate-modal-appear">
            <div className="text-sm font-semibold">Step 1: Copy Bookmarklet</div>
            <div className="bg-muted/50 rounded p-2 border border-border">
              <code className="text-[10px] text-muted-foreground break-all">
                javascript:(async()=&gt;...
              </code>
            </div>
            <button className="w-full bg-primary text-primary-foreground rounded py-2 text-sm font-medium animate-tap-pulse">
              📋 Copy Code
            </button>
            <div className="text-xs text-muted-foreground text-center">
              Tap to copy the bookmarklet code
            </div>
          </div>
        </div>

        {/* Animated finger tap */}
        <div className="absolute animate-finger-tap">
          <div className="text-4xl">👆</div>
        </div>
      </div>

      <style>{`
        @keyframes modal-appear {
          0% {
            opacity: 0;
            transform: scale(0.9);
          }
          20%, 100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes tap-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(142, 186, 111, 0);
          }
          50% {
            box-shadow: 0 0 0 8px rgba(142, 186, 111, 0.3);
          }
        }

        @keyframes finger-tap {
          0%, 30% {
            bottom: 35%;
            left: 50%;
            opacity: 0;
          }
          35%, 65% {
            bottom: 30%;
            left: 50%;
            opacity: 1;
          }
          70% {
            bottom: 28%;
            left: 50%;
            opacity: 1;
          }
          75%, 100% {
            bottom: 28%;
            left: 50%;
            opacity: 0;
          }
        }

        .animate-modal-appear {
          animation: modal-appear 4s ease-in-out infinite;
        }

        .animate-tap-pulse {
          animation: tap-pulse 4s ease-in-out infinite;
        }

        .animate-finger-tap {
          animation: finger-tap 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export function BookmarkletSaveDemo() {
  return (
    <div className="relative w-full h-56 bg-card rounded-lg border border-border overflow-hidden">
      {/* Mobile browser mock */}
      <div className="absolute inset-0 flex flex-col">
        {/* Mobile browser header */}
        <div className="h-12 bg-muted/80 border-b border-border flex items-center justify-between px-3">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-primary/20"></div>
            <span className="text-xs text-muted-foreground">Bookmarks</span>
          </div>
          <div className="text-primary text-sm font-medium animate-pulse-slow">+ Add</div>
        </div>

        {/* Bookmark editor */}
        <div className="flex-1 bg-background/50 p-4 space-y-3">
          <div className="bg-card border border-border rounded-lg p-3 space-y-2">
            <div className="text-xs text-muted-foreground">Name</div>
            <div className="bg-muted/50 rounded px-2 py-1 text-sm border border-border">
              Get ESPN Cookies
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-3 space-y-2 animate-highlight">
            <div className="text-xs text-muted-foreground">URL</div>
            <div className="bg-primary/10 rounded px-2 py-1 text-[10px] font-mono border border-primary/30 text-primary break-all">
              javascript:(async()=&gt;...
            </div>
          </div>

          <div className="text-xs text-center text-muted-foreground">
            Step 2: Save bookmark with copied code as URL
          </div>
        </div>

        {/* Checkmark animation */}
        <div className="absolute bottom-8 right-8 animate-checkmark opacity-0">
          <div className="text-5xl text-primary">✓</div>
        </div>
      </div>

      <style>{`
        @keyframes highlight {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(142, 186, 111, 0);
          }
          50% {
            box-shadow: 0 0 0 4px rgba(142, 186, 111, 0.3);
          }
        }

        @keyframes pulse-slow {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }

        @keyframes checkmark {
          0%, 70% {
            opacity: 0;
            transform: scale(0);
          }
          75% {
            opacity: 1;
            transform: scale(1.2);
          }
          80% {
            transform: scale(0.9);
          }
          85%, 100% {
            opacity: 1;
            transform: scale(1);
          }
        }

        .animate-highlight {
          animation: highlight 4s ease-in-out infinite;
        }

        .animate-pulse-slow {
          animation: pulse-slow 4s ease-in-out infinite;
        }

        .animate-checkmark {
          animation: checkmark 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

export function BookmarkletMobileClickDemo() {
  return (
    <div className="relative w-full h-56 bg-card rounded-lg border border-border overflow-hidden">
      {/* Mobile ESPN mock */}
      <div className="absolute inset-0 flex flex-col">
        {/* Mobile browser with bookmarks bar visible */}
        <div className="h-12 bg-muted/80 border-b border-border flex items-center px-3 gap-2">
          <div className="flex-1 bg-background/50 rounded px-2 py-1 text-xs text-muted-foreground">
            fantasy.espn.com/...123456
          </div>
          <button className="px-2 py-1 bg-primary/20 border border-primary/50 rounded text-xs text-primary animate-bookmarklet-glow">
            📋
          </button>
        </div>

        {/* ESPN Mobile Content */}
        <div className="flex-1 bg-background/50 p-3 space-y-2">
          <div className="bg-red-500/10 border border-red-500/30 rounded p-2 flex items-center gap-2">
            <div className="w-8 h-8 bg-red-500/20 rounded flex items-center justify-center text-red-500 font-bold text-sm">E</div>
            <div className="flex-1 space-y-1">
              <div className="h-2 bg-muted/50 rounded w-24"></div>
              <div className="h-2 bg-muted/30 rounded w-16"></div>
            </div>
          </div>
          <div className="h-12 bg-muted/30 rounded"></div>
          <div className="h-12 bg-muted/30 rounded"></div>

          {/* Success toast */}
          <div className="absolute inset-x-3 bottom-3 bg-primary/20 border border-primary rounded p-3 animate-toast-slide opacity-0">
            <div className="flex items-center gap-2 text-primary text-sm font-medium">
              <div className="text-lg">✓</div>
              <span>Cookies sent to GridironGM!</span>
            </div>
          </div>
        </div>

        {/* Animated finger tap */}
        <div className="absolute animate-finger-tap-bookmark">
          <div className="text-3xl">👆</div>
        </div>
      </div>

      <style>{`
        @keyframes bookmarklet-glow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(142, 186, 111, 0);
          }
          50% {
            box-shadow: 0 0 0 4px rgba(142, 186, 111, 0.4);
          }
        }

        @keyframes finger-tap-bookmark {
          0%, 30% {
            top: 1rem;
            right: 1rem;
            opacity: 0;
          }
          35%, 65% {
            top: 0.75rem;
            right: 1rem;
            opacity: 1;
          }
          70%, 100% {
            top: 0.75rem;
            right: 1rem;
            opacity: 0;
          }
        }

        @keyframes toast-slide {
          0%, 70% {
            opacity: 0;
            transform: translateY(20px);
          }
          75% {
            opacity: 1;
            transform: translateY(0);
          }
          90% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(0);
          }
        }

        .animate-bookmarklet-glow {
          animation: bookmarklet-glow 4s ease-in-out infinite;
        }

        .animate-finger-tap-bookmark {
          animation: finger-tap-bookmark 4s ease-in-out infinite;
        }

        .animate-toast-slide {
          animation: toast-slide 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
