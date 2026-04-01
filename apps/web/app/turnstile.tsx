// // components/TurnstileGate.tsx
// "use client";
// import { Turnstile } from "@marsidev/react-turnstile";
// import { useState, useEffect } from "react";

// export default function TurnstileGate() {
//   const [show, setShow] = useState(false);

//   useEffect(() => {
//     // Only show to non-verified browsers, never blocks page render
//     const already = document.cookie.includes('hv=1');
//     if (!already) setShow(true);
//   }, []);

//   if (!show) return null;

//   return (
//     // Invisible overlay — content still visible behind it
//     // Googlebot never runs useEffect so this never renders for bots
//     <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 50 }}>
//       <Turnstile
//         siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
//         options={{ appearance: 'interaction-only' }}
//         onSuccess={async (token) => {
//           await fetch('/api/turnstile', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ token }),
//           });
//           setShow(false);
//         }}
//       />
//     </div>
//   );
// }