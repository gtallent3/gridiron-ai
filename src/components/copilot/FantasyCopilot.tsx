import { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLeagueContext } from '@/hooks/useLeagueContext';
import { useTokens } from '@/hooks/useTokens';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Send, Loader2, TrendingUp, Users, Activity, AlertCircle, BarChart3, Calendar } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    type?: 'lineup' | 'trade' | 'waiver' | 'injury' | 'what-if';
    data?: any;
  };
}

interface QuickAction {
  label: string;
  icon: any;
  prompt: string;
  type: string;
}

export function FantasyCopilot() {
  const { context } = useLeagueContext();
  const { balance, deductToken, hasUnlimited } = useTokens();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const quickActions: QuickAction[] = [
    { label: 'Optimize Lineup', icon: TrendingUp, prompt: 'Optimize my lineup for this week', type: 'lineup' },
    { label: 'Find Trades', icon: Users, prompt: 'Find trades to improve my team', type: 'trade' },
    { label: 'Waiver Targets', icon: Activity, prompt: 'Show me the best waiver wire pickups', type: 'waiver' },
    { label: 'Injury Report', icon: AlertCircle, prompt: 'Check my roster for injury concerns', type: 'injury' },
    { label: 'Matchup Analysis', icon: BarChart3, prompt: 'Analyze my matchup this week', type: 'matchup' },
    { label: 'Schedule Strength', icon: Calendar, prompt: 'Show strength of schedule for playoffs', type: 'schedule' },
  ];

  useEffect(() => {
    if (context.leagueName && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: `Hi! I'm your Fantasy Copilot for **${context.leagueName}** (${context.platform}). I can help with lineup optimization, trade analysis, waiver recommendations, injury updates, and more. What would you like help with?`
      }]);
    }
  }, [context.leagueName]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return;
    if (!context.leagueId) {
      toast.error('Please select a league first');
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsProcessing(true);

    try {
      // Check tokens
      const tokenCost = 15;
      if (!hasUnlimited && balance < tokenCost) {
        toast.error('Insufficient tokens');
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'You need more tokens to use the copilot. Visit the Shop to get more!'
        }]);
        setIsProcessing(false);
        return;
      }

      // Deduct tokens
      if (!hasUnlimited) {
        const result = await deductToken('ai_query');
        if (!result.success) {
          toast.error('Failed to deduct tokens');
          setIsProcessing(false);
          return;
        }
      }

      // Get session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Please sign in');
        setIsProcessing(false);
        return;
      }

      // Call copilot function
      const { data, error } = await supabase.functions.invoke('fantasy-copilot', {
        body: {
          message: userMessage,
          conversationHistory: messages,
          context: {
            leagueId: context.leagueId,
            leagueName: context.leagueName,
            platform: context.platform,
            teamId: context.teamId,
            teamName: context.teamName,
            week: context.currentWeek,
            scoringType: context.scoringType,
          }
        }
      });

      if (error) throw error;

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        metadata: data.metadata
      }]);

    } catch (error: any) {
      console.error('Copilot error:', error);
      toast.error('Failed to process request');
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.'
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    setInput(action.prompt);
  };

  if (!context.leagueId) {
    return (
      <Card className="p-8 text-center">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-lg font-semibold mb-2">No League Selected</h3>
        <p className="text-muted-foreground">Please select a league to use the Fantasy Copilot.</p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[700px]">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">Fantasy Copilot</h2>
          <Badge variant="secondary">
            {hasUnlimited ? '∞' : balance} tokens
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline" className="font-normal">
            {context.platform}
          </Badge>
          <span>•</span>
          <span>{context.leagueName}</span>
          <span>•</span>
          <span>Week {context.currentWeek}</span>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i} className={line.startsWith('**') ? 'font-semibold' : ''}>
                      {line.replace(/\*\*/g, '')}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {isProcessing && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg p-3">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Quick Actions */}
      {messages.length <= 1 && (
        <div className="p-4 border-t">
          <p className="text-sm text-muted-foreground mb-3">Quick actions:</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.type}
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => handleQuickAction(action)}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {action.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask me anything about your team..."
            disabled={isProcessing}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isProcessing}
            size="icon"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {hasUnlimited ? 'Unlimited queries' : `15 tokens per query • ${balance} remaining`}
        </p>
      </div>
    </Card>
  );
}
