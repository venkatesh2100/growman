import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

interface CloudflareEnv {
  WAE?: {
    writeDataPoint: (data: {
      blobs: string[];
      doubles: number[];
      indexes: string[];
    }) => void;
  };
}

export function middleware(request: NextRequest) {
  const env = process.env as unknown as CloudflareEnv;

  const country    = request.headers.get('cf-ipcountry')   ?? 'XX';
  const region     = request.headers.get('cf-region')      ?? 'Unknown';
  const regionCode = request.headers.get('cf-region-code') ?? 'XX';
  const city       = request.headers.get('cf-ipcity')      ?? 'Unknown';
  const pathname   = new URL(request.url).pathname;

  if (env.WAE) {
    env.WAE.writeDataPoint({
      blobs: [
        country,     // blob1 → cf-ipcountry  e.g. "IN"
        region,      // blob2 → cf-region      e.g. "Andhra Pradesh"
        regionCode,  // blob3 → cf-region-code e.g. "AP"
        city,        // blob4 → cf-ipcity      e.g. "Hyderabad"
        pathname,    // blob5 → page visited   e.g. "/dashboard"
      ],
      doubles: [1],
      indexes: [country],
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};