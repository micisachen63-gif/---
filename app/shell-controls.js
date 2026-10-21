function closeProductMenu(){document.body.classList?.remove('menu-open');$('#mobileMenu')?.setAttribute('aria-expanded','false');}
function openProductMenu(){document.body.classList?.add('menu-open');$('#mobileMenu')?.setAttribute('aria-expanded','true');}
function syncMobileNavigation(){document.querySelectorAll('[data-mobile-go]').forEach(button=>{const key=button.dataset.mobileGo;button.className=(key==='all'&&state.product==='all'&&state.section==='overview')||(key==='monthly'&&state.section==='monthly')?'active':'';button.onclick=()=>{if(key==='menu'){openProductMenu();return;}if(key==='all'){state.section='overview';selectProduct('all');}else{state.section='monthly';render();}if(typeof window!=='undefined')window.scrollTo({top:0,behavior:'smooth'});};});}
if($('#mobileMenu'))$('#mobileMenu').onclick=openProductMenu;
if($('#menuScrim'))$('#menuScrim').onclick=closeProductMenu;
if(document.addEventListener)document.addEventListener('keydown',event=>{if(event.key==='Escape')closeProductMenu();});
if(document.querySelector('.brand'))document.querySelector('.brand').onclick=event=>{event.preventDefault();state.section='overview';selectProduct('all');};
