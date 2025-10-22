import { useState } from "react";
import { MessageSquare, Send, Bot, Coins } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTokens } from "@/hooks/useTokens";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export const AIAssistant = () => {
  const { toast } = useToast();
  const { deductToken, checkBalance, hasUnlimited } = useTokens();
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm your Fantasy Football AI assistant. Ask me about start/sit decisions, trade analysis, or waiver pickups!",
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  
  const MAX_MESSAGE_LENGTH = 2000;
  const MAX_CONVERSATION_LENGTH = 40;

  const handleSend = async () => {
    if (!input.trim()) return;
    
    // Check token balance
    if (!checkBalance(1)) {
      toast({
        title: "Insufficient Tokens",
        description: "You need 1 token to ask a question",
        variant: "destructive",
      });
      return;
    }
    
    // Validate message length
    if (input.length > MAX_MESSAGE_LENGTH) {
      toast({
        title: "Message too long",
        description: `Please limit your message to ${MAX_MESSAGE_LENGTH} characters.`,
        variant: "destructive",
      });
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    
    // Trim conversation history if too long
    let conversationHistory = [...messages, userMessage];
    if (conversationHistory.length > MAX_CONVERSATION_LENGTH) {
      conversationHistory = conversationHistory.slice(-MAX_CONVERSATION_LENGTH);
      setMessages(conversationHistory.slice(0, -1)); // Update state without the new message yet
    }
    
    setMessages(conversationHistory);
    setInput("");
    setIsTyping(true);

    try {
      // Deduct token
      const tokenResult = await deductToken("ai_assistant", `AI Assistant question: ${input.slice(0, 50)}...`);
      if (!tokenResult.success) {
        setIsTyping(false);
        return;
      }

      // Get the user's auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Authentication required",
          description: "Please sign in to use the AI assistant",
          variant: "destructive",
        });
        setIsTyping(false);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fantasy-ai-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            messages: conversationHistory.map((msg) => ({
              role: msg.role,
              content: msg.content,
            })),
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();
      const aiResponse: Message = {
        role: "assistant",
        content: data.message,
      };
      setMessages((prev) => [...prev, aiResponse]);
    } catch (error) {
      console.error("Error getting AI response:", error);
      const errorMessage: Message = {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <section id="assistant" className="py-20 relative">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Section Header */}
          <div className="text-center space-y-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/30 bg-primary/5">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">24/7 Available</span>
            </div>
            <h2 className="text-4xl font-bold">AI Chat Assistant</h2>
            <p className="text-muted-foreground text-lg">
              Get instant answers to your fantasy football questions
            </p>
          </div>

          {/* Chat Interface */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg">
            <CardHeader className="border-b border-border/50">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                Fantasy AI Chat
                <span className="ml-auto flex items-center gap-1 text-sm font-normal text-muted-foreground">
                  <Coins className="h-4 w-4 text-amber-400" />
                  1 token per question
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Messages */}
              <div className="h-[400px] overflow-y-auto p-6 space-y-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex gap-3 ${
                      message.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {message.role === "assistant" && (
                      <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary"
                      }`}
                    >
                      <p className="text-sm leading-relaxed">{message.content}</p>
                    </div>
                    {message.role === "user" && (
                      <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-accent">You</span>
                      </div>
                    )}
                  </div>
                ))}
                {isTyping && (
                  <div className="flex gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-secondary rounded-lg p-4">
                      <div className="flex gap-1">
                        <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="p-4 border-t border-border/50">
                <div className="flex gap-2">
                  <Input
                    placeholder="Ask about start/sit, trades, or waiver pickups..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSend()}
                    className="bg-background border-border"
                    maxLength={MAX_MESSAGE_LENGTH}
                  />
                  <Button onClick={handleSend} disabled={!input.trim() || isTyping} variant="glow">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
};
