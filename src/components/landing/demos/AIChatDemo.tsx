import { useState, useEffect } from "react";
import { MessageCircle, Bot } from "lucide-react";

export const AIChatDemo = () => {
  const [messageIndex, setMessageIndex] = useState(0);
  
  const messages = [
    { text: "Who should I start?", isUser: true },
    { text: "Start Jaylen Waddle for Week 8.", isUser: false },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % (messages.length + 1));
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-[200px] bg-muted/30 rounded-lg p-4 pointer-events-none overflow-hidden relative">
      <div className="space-y-3">
        {messages.slice(0, messageIndex).map((msg, idx) => (
          <div
            key={idx}
            className={`flex items-start gap-2 animate-fade-in ${
              msg.isUser ? "justify-end" : "justify-start"
            }`}
          >
            {!msg.isUser && (
              <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Bot className="h-3 w-3 text-primary" />
              </div>
            )}
            <div
              className={`px-3 py-2 rounded-lg text-xs ${
                msg.isUser
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border"
              }`}
            >
              {msg.text}
            </div>
            {msg.isUser && (
              <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                <MessageCircle className="h-3 w-3" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground">
        Demo Loop
      </div>
    </div>
  );
};
