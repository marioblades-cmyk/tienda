
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://lbraboujrajvzosmddtu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAgotados() {
  const { count, error } = await supabase
    .from('catalogo_productos')
    .select('*', { count: 'exact', head: true })
    .eq('agotado_distribuidor', true);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`COUNT_AGOTADOS: ${count}`);
  }
}

checkAgotados();
