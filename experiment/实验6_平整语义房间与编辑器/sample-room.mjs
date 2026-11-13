// Public, invented geometry for a portable editor demo. No personal scan data.
const polygon = [[-2.5,-2],[-2.5,2],[2.5,2],[2.5,-2]];
const walls = polygon.map((a,i) => {
  const b=polygon[(i+1)%polygon.length], length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const u=[(b[0]-a[0])/length,0,(b[1]-a[1])/length];
  return {a,b,origin:[a[0],0,a[1]],u,n:[u[2],0,-u[0]],length,height:2.8,openings:i===0?[{kind:'window',u0:1,u1:2.7,v0:0.9,v1:2.2}]:i===3?[{kind:'door',u0:0.4,u1:1.3,v0:0,v1:2.1}]:[]};
});
export default {source:'public-invented-sample',polygon,walls,objects:[
  {category:'table',center:[-1.35,0.4,-0.95],size:[1.8,0.8,0.8],rotY:0},
  {category:'storage',center:[1.65,1,-1.5],size:[1.2,2,0.6],rotY:0},
  {category:'chair',center:[-1.35,0.5,0],size:[0.6,1,0.65],rotY:Math.PI},
]};
