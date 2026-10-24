(function(root){
  'use strict';
  const core=root.WorkToolCore || (typeof require==='function' ? require('./core.js') : null);
  const HEADERS=['游戏','版本','完整名称','专服','类别','链接名称','URL','备注'];
  const MANUAL=['记录ID','后台游戏ID',...HEADERS,'创建时间','后台选项'];
  function validate(value){
    const entry={};
    for(const key of ['id','gameId','game','version','full','server','category','name','url','note','label']){
      entry[key]=String(value?.[key] || '').trim();
      if(entry[key].length>2048 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(entry[key])) throw Error('输入过长或包含不支持的字符');
    }
    for(const [key,label] of [['id','请求编号'],['gameId','后台游戏ID'],['game','游戏名称'],['full','完整游戏名称'],['name','链接名称']]){
      if(!entry[key]) throw Error('请填写'+label);
    }
    let url;try{url=new URL(entry.url);}catch{throw Error('请输入完整的 HTTP 或 HTTPS 链接');}
    if(!['http:','https:'].includes(url.protocol))throw Error('链接只支持 HTTP 或 HTTPS');
    entry.url=url.href;entry.category=entry.category || '其他';
    return entry;
  }
  function suggest(selection,data){
    const match=core.match(selection.label,data,selection.id);
    const versions=match?.game ? Object.values(match.game.versions) : [];
    const chosen=match?.version ? versions.find(v=>v.full===match.version) : versions.length===1 ? versions[0] : null;
    const empty={links:[],notes:[]};
    const server=core.selectedServer(selection.label,chosen || empty) || '';
    let full=selection.label.replace(/^\d+-/,'').split('-').pop().trim();
    full=full.replace(/[（(]([^()（）]*)[）)]/g,(all,part)=>/专服|混服|渠道|联盟/.test(part)?'':all).replace(/【([^】]+)】/g,'（$1）').trim();
    const parsed=/^(.*?)[（(](.*?)[）)]\s*(.*)$/.exec(full);
    const game=match?.game?.name || (parsed?parsed[1].trim():full);
    const version=chosen?.version || (parsed?[parsed[2],parsed[3]].filter(Boolean).join(' '):'');
    let scope=server;
    if(chosen && server){
      const tokens=[...chosen.links.map(l=>l.server),...chosen.notes.map(n=>n[0])].flatMap(core.splitServers);
      scope=tokens.find(s=>core.serverKey(s)===server) || server;
    }
    return {game,full:chosen?.full || full,version,server:scope,versions,needsVersion:versions.length>1&&!chosen,ambiguous:!!match?.ambiguous};
  }
  const linkRow=e=>[e.game,e.version,e.full,e.server,e.category,e.name,e.url,e.note];
  const fromManual=r=>({id:r['记录ID'],gameId:r['后台游戏ID'],game:r['游戏'],version:r['版本'],full:r['完整名称'],server:r['专服'],category:r['类别'],name:r['链接名称'],url:r['URL'],note:r['备注'],label:r['后台选项']});
  function sameLink(row,entry){
    let url;try{url=new URL(row['URL']).href;}catch{return false;}
    const scopes=s=>core.splitServers(s).map(core.serverKey).sort().join('/');
    return row['游戏']===entry.game && row['完整名称']===entry.full && scopes(row['专服'])===scopes(entry.server) && url===entry.url;
  }
  const api={HEADERS,MANUAL,validate,suggest,linkRow,fromManual,sameLink};
  root.WorkToolEntries=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
