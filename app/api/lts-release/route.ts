import { currentLtsRelease } from '@/lib/lts-release';

export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(await currentLtsRelease(), {
    headers: { 'Cache-Control': 'public,max-age=60,s-maxage=60', 'Access-Control-Allow-Origin': '*' },
  });
}
