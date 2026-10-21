/* Pure markup helper. No network fetch, DOM writes, routing, or financial logic. */
function brandLogo(platform,{size=44,className='',decorative=false}={}){
  const brands={win:'贏麻了',qz:'茄子',song:'爽爆',rd:'紅鑽',lucky:'來好運',bo:'來博',fcc:'財哥',o8:'發又發',aos:'黑桃A',cgb:'超吉爆',goldfun:'金來快',o9:'黑狗兄'};
  const aliases={winmalo:'win',qzplays:'qz','song-yy':'song',rdplays:'rd',lylucky:'lucky',lybobet:'bo',goldfun88:'goldfun',o9play:'o9',贏麻了:'win',茄子:'qz',爽爆:'song',紅鑽:'rd',來好運:'lucky',來博:'bo',財哥:'fcc',發又發:'o8',黑桃A:'aos',超吉爆:'cgb',超級爆:'cgb',金來快:'goldfun',黑狗兄:'o9'};
  const raw=typeof platform==='object'&&platform?platform.key||platform.id||platform.name:platform;
  const key=Object.hasOwn(brands,raw)?raw:Object.hasOwn(aliases,raw)?aliases[raw]:null;
  if(!key)return '';
  const edge=Number.isFinite(Number(size))?Math.max(20,Math.min(240,Math.round(Number(size)))):44;
  const cleanClass=String(className).replace(/[^a-zA-Z0-9 _-]/g,'').trim();
  const directory=['fcc','o8','aos','cgb','goldfun','o9'].includes(key)?'competitor-logos':'brand-logos';
  const version=key==='cgb'?'v3':'v2';
  return `<span class="brand-logo${cleanClass?' '+cleanClass:''}" data-brand="${key}" style="--brand-logo-size:${edge}px"${decorative?' aria-hidden="true"':''}><img src="/${directory}/${key}-${version}.webp" alt="${decorative?'':brands[key]}" width="512" height="512" loading="lazy" decoding="async"></span>`;
}
