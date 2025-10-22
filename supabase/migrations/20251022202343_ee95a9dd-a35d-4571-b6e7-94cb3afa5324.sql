-- Add RLS policies for admins to manage weekly props
CREATE POLICY "Admins can insert props" 
ON public.weekly_props
FOR INSERT 
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update props" 
ON public.weekly_props
FOR UPDATE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete props" 
ON public.weekly_props
FOR DELETE 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));