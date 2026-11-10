import { NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url || !url.startsWith('https://firebasestorage.googleapis.com/')) {
    return new NextResponse('Bad request', { status: 400 });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const buffer = Buffer.from(await upstream.arrayBuffer());

    const jpeg = await sharp(buffer)
      .rotate()
      .jpeg({ quality: 85 })
      .toBuffer();

    return new NextResponse(jpeg, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('convert error:', err);
    return new NextResponse('Error', { status: 500 });
  }
}
