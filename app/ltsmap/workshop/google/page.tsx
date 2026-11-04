import { redirect } from 'next/navigation';

/** Preserve bookmarks and island links from the Google workshop trial. */
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(await searchParams)){
    for(const item of Array.isArray(value)?value:value===undefined?[]:[value])query.append(key,item);
  }
  redirect('/ltsmap/workshop'+(query.size?'?'+query.toString():''));
}
