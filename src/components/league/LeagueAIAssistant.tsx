import { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, Bot, ThumbsUp, ThumbsDown, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { useTokens } from "@/hooks/useTokens";
import { useNavigate } from "react-router-dom";

type League = {
  id: string;
  platform: string;
  league_name: string;
  league_size: number;
  scoring_type: string;
  league_id: string;
};

type Team = {
  id: string;
  team_id: string;
  team_name: string;
  roster: any;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  expanded?: boolean;
  feedback?: "up" | "down" | null;
};

type LeagueAIAssistantProps = {
  league: League;
  userTeam: Team | null;
};

export const LeagueAIAssistant = ({ league, userTeam }: LeagueAIAssistantProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { balance, hasUnlimited, checkBalance, deductToken } = useTokens();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [leagueContext, setLeagueContext] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const MAX_MESSAGE_LENGTH = 500;

  useEffect(() => {
    // Build league context automatically
    const rosterSize = userTeam?.roster ? 
      (Array.isArray(userTeam.roster) ? userTeam.roster.length : 
       (userTeam.roster.starters?.length || 0) + (userTeam.roster.bench?.length || 0)) : 0;
    
    const context = `League: ${league.league_name} (${league.league_size} teams, ${league.scoring_type} scoring)${
      userTeam ? `, Team: ${userTeam.team_name}, Roster size: ${rosterSize}` : ''
    }`;
    
    setLeagueContext(context);
    
    // Initial greeting
    setMessages([{
      role: "assistant",
      content: `Hi! I'm your AI assistant for ${league.league_name}. Ask me about start/sit decisions or trade evaluations.`,
    }]);
  }, [league, userTeam]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleQuickAction = (action: string) => {
    let prompt = "";
    switch (action) {
      case "start-sit":
        prompt = "Analyze my lineup and tell me who to start this week";
        break;
      case "trade":
        prompt = "I'm considering a trade. Can you help me evaluate it?";
        break;
      case "upgrade":
        prompt = "Which position should I try to upgrade via trade?";
        break;
      case "compare":
        prompt = "Compare two players for me";
        break;
    }
    setInput(prompt);
  };

  const handleFeedback = (messageIndex: number, feedback: "up" | "down") => {
    setMessages(prev => prev.map((msg, idx) => 
      idx === messageIndex ? { ...msg, feedback } : msg
    ));
    toast({
      title: "Feedback recorded",
      description: "Thank you for helping improve the assistant!",
    });
  };

  const toggleExpand = (messageIndex: number) => {
    setMessages(prev => prev.map((msg, idx) => 
      idx === messageIndex ? { ...msg, expanded: !msg.expanded } : msg
    ));
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    
    if (input.length > MAX_MESSAGE_LENGTH) {
      toast({
        title: "Message too long",
        description: `Please limit your message to ${MAX_MESSAGE_LENGTH} characters.`,
        variant: "destructive",
      });
      return;
    }

    if (!userTeam) {
      toast({
        title: "Team not synced",
        description: "Connect your league first to activate the AI Assistant.",
        variant: "destructive",
      });
      return;
    }

    // Check token balance
    if (!hasUnlimited && !checkBalance(1)) {
      toast({
        title: "Insufficient Tokens",
        description: "You need 1 token to ask a question",
        variant: "destructive",
      });
      setTimeout(() => navigate("/shop"), 2000);
      return;
    }

    const userMessage: Message = { role: "user", content: input };
    const conversationHistory = [...messages, userMessage];
    
    setMessages(conversationHistory);
    setInput("");
    setIsTyping(true);

    try {
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
            leagueId: league.id,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();
      
      // Deduct token after successful response
      await deductToken("ai_assistant", `Question: ${input.substring(0, 50)}...`);
      
      const aiResponse: Message = {
        role: "assistant",
        content: data.message,
        expanded: false,
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
    <div className="max-w-4xl mx-auto">
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm shadow-lg">
        <CardHeader className="border-b border-border/50">
          <div className="space-y-2">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              AI Assistant
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Ask for quick, league-specific fantasy advice
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <Coins className="h-3 w-3" />
                1 token per question
              </Badge>
              <Badge variant="outline" className="text-xs">
                {league.scoring_type}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {league.league_size} teams
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Messages */}
          <div className="h-[500px] overflow-y-auto p-6 space-y-4">
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
                <div className="flex flex-col gap-2 max-w-[80%]">
                  <div
                    className={`rounded-lg p-4 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary"
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-line">
                      {message.content}
                    </p>
                  </div>
                  {message.role === "assistant" && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleFeedback(index, "up")}
                      >
                        <ThumbsUp className={`h-3 w-3 ${message.feedback === "up" ? "fill-current" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => handleFeedback(index, "down")}
                      >
                        <ThumbsDown className={`h-3 w-3 ${message.feedback === "down" ? "fill-current" : ""}`} />
                      </Button>
                    </div>
                  )}
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
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Actions */}
          <div className="px-4 py-3 border-t border-border/50 bg-secondary/30">
            <div className="flex flex-wrap gap-2 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction("start-sit")}
                className="text-xs"
              >
                Start/Sit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction("trade")}
                className="text-xs"
              >
                Trade Check
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction("waiver")}
                className="text-xs"
              >
                Waiver Advice
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction("projection")}
                className="text-xs"
              >
                Weekly Projection
              </Button>
            </div>
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
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {input.length}/{MAX_MESSAGE_LENGTH} characters
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
