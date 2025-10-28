import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Shield, AlertTriangle, Ban, Link as LinkIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function RiskAdmin() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [riskEvents, setRiskEvents] = useState<any[]>([]);
  const [accountLinks, setAccountLinks] = useState<any[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      navigate('/auth');
      return;
    }

    setUser(session.user);

    // Check admin role
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', session.user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roles) {
      toast({
        title: "Access Denied",
        description: "Admin privileges required",
        variant: "destructive",
      });
      navigate('/');
      return;
    }

    setIsAdmin(true);
    loadData();
  };

  const loadData = async () => {
    setIsLoading(true);

    // Load high-risk events
    const { data: events } = await supabase
      .from('risk_events')
      .select('*')
      .gte('risk_score', 50)
      .order('created_at', { ascending: false })
      .limit(50);

    // Load pending account links
    const { data: links } = await supabase
      .from('account_links')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    setRiskEvents(events || []);
    setAccountLinks(links || []);
    setIsLoading(false);
  };

  const handleApproveLink = async (linkId: string) => {
    const { error } = await supabase
      .from('account_links')
      .update({ 
        status: 'approved',
        decided_at: new Date().toISOString(),
        decided_by: user.id,
      })
      .eq('id', linkId);

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Success", description: "Account link approved" });
      loadData();
    }
  };

  const handleRejectLink = async (linkId: string) => {
    const { error } = await supabase
      .from('account_links')
      .update({ 
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: user.id,
      })
      .eq('id', linkId);

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "Success", description: "Account link rejected" });
      loadData();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center gap-3 mb-8">
            <Shield className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-3xl font-bold">Risk Management</h1>
              <p className="text-muted-foreground">Monitor and manage account security risks</p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="h-5 w-5" />
                Pending Account Merges
              </CardTitle>
              <CardDescription>Review and approve duplicate account merge requests</CardDescription>
            </CardHeader>
            <CardContent>
              {accountLinks.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No pending account links</p>
              ) : (
                <div className="space-y-4">
                  {accountLinks.map((link) => (
                    <div key={link.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{link.primary_user_id}</span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-mono text-sm">{link.secondary_user_id}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Requested {new Date(link.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Badge variant="outline">Pending</Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          onClick={() => handleApproveLink(link.id)}
                          variant="default"
                        >
                          Approve Merge
                        </Button>
                        <Button 
                          size="sm" 
                          onClick={() => handleRejectLink(link.id)}
                          variant="outline"
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                High-Risk Events
              </CardTitle>
              <CardDescription>Recent signup attempts and security alerts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {riskEvents.map((event) => (
                  <div key={event.id} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {event.risk_score >= 70 ? (
                          <Ban className="h-4 w-4 text-destructive" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        )}
                        <span className="font-medium capitalize">{event.event_type.replace('_', ' ')}</span>
                      </div>
                      <Badge variant={event.risk_score >= 70 ? "destructive" : "secondary"}>
                        Risk: {event.risk_score}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{event.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
