"""Fire-danger indices per commune: Nesterov P (5-level Vietnamese forecast classes) and Canadian FWI system.

Daily chain from 2024-01-01: ERA5-Land noon (12:00 VN) inputs -> Open-Meteo hours after the ERA5 series ends
(recent analysis, then forecast). Validated against GEE FIRMS thermal-anomaly history (not verified fires).
Outputs: data/processed/fire-danger-daily.csv, data/web/fire-danger.json
"""
import csv,json,math,datetime,collections
from pathlib import Path
import numpy as np
from _geo import commune_grid,ROOT
OUT=ROOT/'data/web';OUT.mkdir(parents=True,exist_ok=True)
# Nesterov classes as published in provincial decisions under ND 156/2018 Mau 04 (e.g. Kien Giang 07/2024, Dong Nai 47/2026)
P_CLASSES=[(5000,1),(10000,2),(15000,3),(20000,4),(math.inf,5)]
P_LABELS={1:'Cấp I – Thấp',2:'Cấp II – Trung bình',3:'Cấp III – Cao',4:'Cấp IV – Nguy hiểm',5:'Cấp V – Cực kỳ nguy hiểm'}
def p_class(p):
 for lim,c in P_CLASSES:
  if p<=lim:return c
def esat(t):return 6.1078*math.exp(17.27*t/(t+237.3))
# --- Canadian FWI (Van Wagner 1987; day-length factors for 10-30N as in cffdrs) ---
LE=[7.9,8.4,8.9,9.5,9.9,10.2,10.1,9.7,9.1,8.6,8.1,7.8];LF=1.39
def ffmc(T,H,W,ro,Fo):
 mo=147.2*(101-Fo)/(59.5+Fo)
 if ro>0.5:
  rf=ro-0.5
  if mo>150:mo=mo+42.5*rf*math.exp(-100/(251-mo))*(1-math.exp(-6.93/rf))+0.0015*(mo-150)**2*math.sqrt(rf)
  else:mo=mo+42.5*rf*math.exp(-100/(251-mo))*(1-math.exp(-6.93/rf))
  mo=min(mo,250)
 ed=0.942*H**0.679+11*math.exp((H-100)/10)+0.18*(21.1-T)*(1-math.exp(-0.115*H))
 if mo>ed:
  ko=0.424*(1-(H/100)**1.7)+0.0694*math.sqrt(W)*(1-(H/100)**8);kd=ko*0.581*math.exp(0.0365*T);m=ed+(mo-ed)*10**(-kd)
 else:
  ew=0.618*H**0.753+10*math.exp((H-100)/10)+0.18*(21.1-T)*(1-math.exp(-0.115*H))
  if mo<ew:
   k1=0.424*(1-((100-H)/100)**1.7)+0.0694*math.sqrt(W)*(1-((100-H)/100)**8);kw=k1*0.581*math.exp(0.0365*T);m=ew-(ew-mo)*10**(-kw)
  else:m=mo
 return 59.5*(250-m)/(147.2+m)
def dmc(T,H,ro,Po,mon):
 T=max(T,-1.1);K=1.894*(T+1.1)*(100-H)*LE[mon-1]*1e-6
 if ro>1.5:
  re=0.92*ro-1.27;Mo=20+math.exp(5.6348-Po/43.43)
  b=100/(0.5+0.3*Po) if Po<=33 else (14-1.3*math.log(Po) if Po<=65 else 6.2*math.log(Po)-17.2)
  Mr=Mo+1000*re/(48.77+b*re);Po=max(244.72-43.43*math.log(Mr-20),0)
 return Po+100*K
def dc(T,ro,Do,mon):
 T=max(T,-2.8)
 if ro>2.8:
  rd=0.83*ro-1.27;Qr=800*math.exp(-Do/400)+3.937*rd;Do=max(400*math.log(800/Qr),0)
 return Do+0.5*max(0.36*(T+2.8)+LF,0)
def isi(F,W):
 m=147.2*(101-F)/(59.5+F);return 0.208*math.exp(0.05039*W)*91.9*math.exp(-0.1386*m)*(1+m**5.31/4.93e7)
def bui(P,D):
 if P<=0.4*D:U=0.8*P*D/(P+0.4*D) if P+0.4*D>0 else 0
 else:U=P-(1-0.8*D/(P+0.4*D))*(0.92+(0.0114*P)**1.7)
 return max(U,0)
def fwi(R,U):
 fD=0.626*U**0.809+2 if U<=80 else 1000/(25+108.64*math.exp(-0.023*U));B=0.1*R*fD
 return math.exp(2.72*(0.434*math.log(B))**0.647) if B>1 else B
# --- inputs ---
rows=collections.defaultdict(dict)
for r in csv.DictReader(open(ROOT/'data/processed/fire-weather-noon-inputs.csv',encoding='utf-8')):
 if not r['temperature_c']:continue
 rain=float(r['rain_previous24h_mm']) if r['rain_previous24h_mm'] else 0.0
 rows[r['commune_code']][r['date_local']]=dict(T=float(r['temperature_c']),Td=float(r['dewpoint_c']),H=min(max(float(r['relative_humidity_percent']),1),100),
  W=float(r['wind_kmh']),rain=max(rain,0),source='era5_land_reanalysis',qc=r['quality_status'])
om=json.loads((ROOT/'data/collected/open-meteo/hourly-communes.json').read_text(encoding='utf-8'))
collected=datetime.datetime.fromisoformat(om['collected_at_utc'])
today_local=(collected+datetime.timedelta(hours=7)).date()
om_bias=[]
for c in om['communes']:
 h=c['data']['hourly'];times=h['time'];idx={t:i for i,t in enumerate(times)}
 for i,t in enumerate(times):
  if not t.endswith('T12:00'):continue
  d=t[:10];prev=[h['precipitation'][j] for j in range(max(0,i-23),i+1)]
  if None in (h['temperature_2m'][i],h['relative_humidity_2m'][i]) or len(prev)<24 or None in prev:continue
  rec=dict(T=h['temperature_2m'][i],Td=h['dew_point_2m'][i],H=min(max(h['relative_humidity_2m'][i],1),100),W=h['wind_speed_10m'][i],
   rain=sum(prev),wind_dir=h['wind_direction_10m'][i],source='open_meteo_forecast' if datetime.date.fromisoformat(d)>today_local else 'open_meteo_recent',qc='model_point')
  era=rows[c['commune_code']].get(d)
  if era and era['source']=='era5_land_reanalysis':om_bias.append((rec['T']-era['T'],rec['H']-era['H'],rec['rain']-era['rain']));continue
  rows[c['commune_code']][d]=rec
# --- run chains ---
def run(series):
 F,Pd,D=85.0,6.0,15.0;P=0.0;out=[];start=None
 for d in sorted(series):
  x=series[d];mon=int(d[5:7])
  F=ffmc(x['T'],x['H'],x['W'],x['rain'],F);Pd=dmc(x['T'],x['H'],x['rain'],Pd,mon);D=dc(x['T'],x['rain'],D,mon)
  R=isi(F,x['W']);U=bui(Pd,D);S=fwi(R,U)
  deficit=max(esat(x['T'])-esat(x['Td']),0)
  P=0.0 if x['rain']>5 else P+x['T']*deficit
  out.append(dict(date=d,**{k:x[k] for k in ('T','H','W','rain','source','qc')},deficit_hpa=deficit,nesterov_p=P,p_class=p_class(P),
   ffmc=F,dmc=Pd,dc=D,isi=R,bui=U,fwi=S))
 return out
lookup,codes,fc=commune_grid()
names={f['properties']['code']:f['properties']['fullName'] for f in fc['features']}
result={c:run(rows[c]) for c in codes if c in rows}
with open(ROOT/'data/processed/fire-danger-daily.csv','w',newline='',encoding='utf-8') as f:
 w=csv.writer(f);w.writerow(['commune_code','date_local','input_source','quality','temperature_c','rh_percent','wind_kmh','rain24h_mm','deficit_hpa','nesterov_p','nesterov_class','ffmc','dmc','dc','isi','bui','fwi'])
 for c,rs in result.items():
  for r in rs:w.writerow([c,r['date'],r['source'],r['qc'],round(r['T'],2),round(r['H'],1),round(r['W'],1),round(r['rain'],2),round(r['deficit_hpa'],2),round(r['nesterov_p']),r['p_class'],round(r['ffmc'],2),round(r['dmc'],2),round(r['dc'],2),round(r['isi'],2),round(r['bui'],2),round(r['fwi'],2)])
# --- validation against FIRMS history (commune-day has >=1 thermal anomaly) ---
hist_path=ROOT/'data/collected/history/firms-gee-modis-2024-now.json';validation=dict(status='firms_history_missing')
if hist_path.exists():
 pts=json.loads(hist_path.read_text(encoding='utf-8'))['points'];fire_days=collections.Counter()
 for p in pts:
  c=lookup(p['lon'],p['lat'])
  if c:fire_days[(c,p['date'])]+=1
 last_hist=max(p['date'] for p in pts) if pts else None
 samples=[(r['p_class'],r['fwi'],r['nesterov_p'],1 if fire_days.get((c,r['date'])) else 0) for c,rs in result.items() for r in rs
  if r['date']>='2024-03-01' and last_hist and r['date']<=last_hist and r['source']!='open_meteo_forecast']
 by=collections.defaultdict(lambda:[0,0])
 for cls,_,_,y in samples:by[cls][0]+=1;by[cls][1]+=y
 def auc(scores,ys):
  order=np.argsort(scores);ranks=np.empty(len(scores));ranks[order]=np.arange(1,len(scores)+1)
  pos=np.array(ys)==1;npos=pos.sum();nneg=len(ys)-npos
  return float((ranks[pos].sum()-npos*(npos+1)/2)/(npos*nneg)) if npos and nneg else None
 ys=[s[3] for s in samples]
 validation=dict(status='evaluated_against_unverified_thermal_anomalies',reference='GEE FIRMS MODIS 1 km pixels inside commune, same local date',
  period=['2024-03-01',last_hist],commune_days=len(samples),commune_days_with_hotspot=int(sum(ys)),
  hotspot_rate_by_nesterov_class={str(k):dict(days=v[0],hotspot_days=v[1],rate=round(v[1]/v[0],4) if v[0] else None) for k,v in sorted(by.items())},
  auc_nesterov_p=auc([s[2] for s in samples],ys),auc_fwi=auc([s[1] for s in samples],ys),
  caveat='Thermal anomalies include agricultural burning and are not verified forest fires; AUC measures association, not calibrated probability.')
if om_bias:
 a=np.array(om_bias);validation['open_meteo_vs_era5_overlap']=dict(days=len(a),mean_bias_temperature_c=round(float(a[:,0].mean()),2),
  mean_bias_rh_percent=round(float(a[:,1].mean()),2),mean_bias_rain24h_mm=round(float(a[:,2].mean()),2))
# --- web summary: last 60 days + forecast ---
summary=[]
for c,rs in result.items():
 hist=[r for r in rs if r['source']!='open_meteo_forecast'];fc_=[r for r in rs if r['source']=='open_meteo_forecast'][:7]
 cur=hist[-1] if hist else None
 def slim(r):return dict(date=r['date'],source=r['source'],T=round(r['T'],1),H=round(r['H']),W=round(r['W'],1),rain=round(r['rain'],1),
  p=round(r['nesterov_p']),cls=r['p_class'],fwi=round(r['fwi'],1),ffmc=round(r['ffmc'],1),dmc=round(r['dmc'],1),dc=round(r['dc'],1),isi=round(r['isi'],1),bui=round(r['bui'],1))
 summary.append(dict(code=c,name=names[c],current=slim(cur) if cur else None,forecast=[slim(r) for r in fc_],recent=[slim(r) for r in hist[-60:]]))
monthly=collections.defaultdict(lambda:collections.Counter())
for c,rs in result.items():
 for r in rs:
  if r['source']!='open_meteo_forecast':monthly[r['date'][:7]][r['p_class']]+=1
payload=dict(product='fire_danger_index',generated_at_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
 inputs_collected_at_utc=om['collected_at_utc'],today_local=today_local.isoformat(),
 method=dict(nesterov='P = Σ t·d (t: nhiệt độ không khí, d: độ chênh lệch bão hòa hPa) cộng dồn qua các ngày mưa ≤ 5 mm; K = 0 khi mưa ngày > 5 mm',
  nesterov_classes={str(c):dict(label=P_LABELS[c],max_p=(None if lim==math.inf else lim)) for lim,c in P_CLASSES},
  nesterov_class_source='Mẫu số 04 Phụ lục III Nghị định 156/2018/NĐ-CP; ngưỡng Pi theo các quyết định cấp tỉnh (ví dụ QĐ 07/2024/QĐ-UBND Kiên Giang). Chưa có bảng tra riêng được duyệt cho vùng Kon Tum.',
  observation_hour='12:00 giờ Việt Nam (ERA5-Land 05:00 UTC) thay cho 13:00 theo quy định – do dữ liệu nguồn',
  fwi='Canadian Forest Fire Weather Index System (Van Wagner 1987), hệ số độ dài ngày vĩ độ 10–30°N; khởi tạo FFMC 85, DMC 6, DC 15 ngày 2024-01-01, 60 ngày đầu là giai đoạn khởi động',
  inputs='ERA5-Land (tái phân tích) đến hết chuỗi; sau đó Open-Meteo (phân tích gần đây và dự báo) tại điểm đại diện xã',
  status='automated_index_not_official_warning'),
 validation=validation,monthly_class_counts={m:dict(v) for m,v in sorted(monthly.items())},communes=summary)
(OUT/'fire-danger.json').write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8')
print(json.dumps(validation,ensure_ascii=False,indent=1))
print('today',today_local,'forecast days',len(summary[0]['forecast']),'current',summary[0]['current'])
