import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Loader2, 
  CreditCard, 
  Calendar, 
  AlertCircle,
  CheckCircle,
  RefreshCw,
  ExternalLink 
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Billing() {
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { subscription, loading: subLoading, checkSubscription, openCustomerPortal, cancelSubscription, resumeSubscription } = useSubscription();

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
    await loadInvoices(session.user.id);
    setIsLoading(false);
  };

  const loadInvoices = async (userId: string) => {
    const { data } = await supabase
      .from('invoices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    setInvoices(data || []);
  };

  const handleCancelSubscription = async () => {
    setActionLoading(true);
    try {
      await cancelSubscription();
      toast({
        title: "Subscription Cancelled",
        description: `Your access remains until ${new Date(subscription.subscription_end!).toLocaleDateString()}. You can resume anytime before then.`,
      });
      setShowCancelDialog(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to cancel subscription",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeSubscription = async () => {
    setActionLoading(true);
    try {
      await resumeSubscription();
      toast({
        title: "Subscription Resumed",
        description: `We'll keep your subscription active beyond ${new Date(subscription.subscription_end!).toLocaleDateString()}.`,
      });
      setShowResumeDialog(false);
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resume subscription",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = () => {
    if (subscription.cancel_at_period_end) {
      return <Badge variant="destructive">Ends {new Date(subscription.subscription_end!).toLocaleDateString()}</Badge>;
    }
    if (subscription.status === 'active') {
      return <Badge variant="default">Active</Badge>;
    }
    if (subscription.status === 'trialing') {
      return <Badge variant="secondary">Trial</Badge>;
    }
    if (subscription.status === 'past_due') {
      return <Badge variant="destructive">Past Due</Badge>;
    }
    return <Badge variant="outline">No Active Subscription</Badge>;
  };

  const formatAmount = (amount: number, currency: string = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  if (isLoading || subLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header user={user} />
      <main className="container mx-auto px-4 pt-24 pb-12">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold">Billing</h1>
              <p className="text-muted-foreground">Manage your subscription and payment methods</p>
            </div>
            <Button onClick={checkSubscription} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Current Plan
                  </CardTitle>
                  <CardDescription>Your subscription status and details</CardDescription>
                </div>
                {getStatusBadge()}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {subscription.subscribed ? (
                <>
                  <div className="flex items-start gap-4">
                    {subscription.cancel_at_period_end ? (
                      <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                    ) : (
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <p className="font-medium">
                        {subscription.cancel_at_period_end 
                          ? `Access ends on ${new Date(subscription.subscription_end!).toLocaleDateString()}`
                          : subscription.status === 'trialing'
                          ? `Trial ends ${new Date(subscription.trial_end!).toLocaleDateString()}`
                          : `Renews on ${new Date(subscription.subscription_end!).toLocaleDateString()}`
                        }
                      </p>
                      {subscription.status === 'past_due' && (
                        <p className="text-sm text-destructive mt-1">
                          Payment failed. Please update your payment method.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-4 border-t">
                    <Button onClick={() => openCustomerPortal()}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Update Payment Method
                    </Button>
                    
                    {subscription.cancel_at_period_end ? (
                      <Button onClick={() => setShowResumeDialog(true)} variant="default">
                        Resume Subscription
                      </Button>
                    ) : (
                      <Button onClick={() => setShowCancelDialog(true)} variant="outline">
                        Cancel Subscription
                      </Button>
                    )}
                    
                    <Button onClick={() => openCustomerPortal()} variant="outline">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Manage in Stripe
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">No active subscription</p>
                  <Button onClick={() => navigate('/shop')}>
                    View Plans
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Invoices
              </CardTitle>
              <CardDescription>Your billing history</CardDescription>
            </CardHeader>
            <CardContent>
              {invoices.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No invoices yet</p>
              ) : (
                <div className="space-y-3">
                  {invoices.map((invoice) => (
                    <div key={invoice.id} className="flex items-center justify-between border rounded-lg p-4">
                      <div>
                        <p className="font-medium">
                          {formatAmount(invoice.amount_paid, invoice.currency)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(invoice.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant={invoice.status === 'paid' ? 'default' : 'destructive'}>
                          {invoice.status}
                        </Badge>
                        {invoice.hosted_invoice_url && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => window.open(invoice.hosted_invoice_url, '_blank')}
                          >
                            View Invoice
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Your access will remain until{" "}
              {subscription.subscription_end && new Date(subscription.subscription_end).toLocaleDateString()}.
              You can resume anytime before then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelSubscription} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Cancel Subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResumeDialog} onOpenChange={setShowResumeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resume Subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              We'll keep your subscription active beyond{" "}
              {subscription.subscription_end && new Date(subscription.subscription_end).toLocaleDateString()}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResumeSubscription} disabled={actionLoading}>
              {actionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Resume Subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
