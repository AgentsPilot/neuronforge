import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
(async () => {
  const mod = await import('../app/api/business-os/chat-v4/route');
  console.log('ROUTE OK exports:', Object.keys(mod).join(', '));
})();
