import path from 'node:path';
import {validIsoDay,readArchiveJson} from './o8-archive-store.mjs';
import {validateCompetitorRank} from './competitor-archive-store.mjs';

const monthEnd=month=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);
export function dailyMonthlyRankPlan(site,today,{existingFullMonths=[]}={}){
 if(!validIsoDay(today))throw Error('archive_window_invalid');if(site.recentOnlyRestriction)return{windows:[],reason:'restricted_recent_days_only'};
 const through=new Date(Date.parse(today)-86400000).toISOString().slice(0,10),month=through.slice(0,7),previous=new Date(month+'-01T00:00:00Z');previous.setUTCMonth(previous.getUTCMonth()-1);const prevMonth=previous.toISOString().slice(0,7),prevEnd=monthEnd(prevMonth),closedFullMonth=through===monthEnd(month),day=Number(through.slice(8)),prevDays=Number(prevEnd.slice(8)),windows=[];
 const add=(from,to,role)=>{const existing=windows.find(item=>item.from===from&&item.through===to);if(existing)existing.roles.push(role);else windows.push({from,through:to,roles:[role]});};
 add(month+'-01',through,'current_month_closed');
 if(closedFullMonth)add(prevMonth+'-01',prevEnd,'previous_comparison');else if(day<=prevDays)add(prevMonth+'-01',prevMonth+'-'+String(day).padStart(2,'0'),'previous_comparison');
 if(!existingFullMonths.includes(prevMonth))add(prevMonth+'-01',prevEnd,'previous_full_month_missing');
 return{windows,through,previousComparable:closedFullMonth||day<=prevDays,reason:closedFullMonth||day<=prevDays?null:'previous_calendar_has_fewer_days'};
}
export async function inspectDailyMonthlyRankPlan(site,today,{live}={}){const plan=dailyMonthlyRankPlan(site,today),candidate=plan.windows.find(item=>item.roles.includes('previous_full_month_missing'));if(!candidate)return plan;const file=`competitor-period-rank-${site.key}-${candidate.from}_${candidate.through}.json`,raw=await readArchiveJson(path.join(live,file));const valid=raw?.from===candidate.from&&raw?.through===candidate.through&&validateCompetitorRank(raw,site).valid;if(!valid)return plan;return dailyMonthlyRankPlan(site,today,{existingFullMonths:[candidate.from.slice(0,7)]});}
