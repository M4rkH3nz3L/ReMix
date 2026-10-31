import { rtmpUrlProblem } from '@/lib/liveDestinations';


describe('rtmpUrlProblem (PRO-LIVE L7 kliens-tükör)', () => {
  it('a platform-ingest címek átmennek', () => {
    expect(rtmpUrlProblem('rtmp://a.rtmp.youtube.com/live2')).toBeNull();
    expect(rtmpUrlProblem('rtmps://live-api-s.facebook.com:443/rtmp/')).toBeNull();
  });
  it('rossz séma / belső cím / jelszó → hiba-kulcs', () => {
    expect(rtmpUrlProblem('https://youtube.com')).toBe('live.dest.errScheme');
    expect(rtmpUrlProblem('rtmp://192.168.0.10/live')).toBe('live.dest.errPrivate');
    expect(rtmpUrlProblem('rtmp://localhost/live')).toBe('live.dest.errPrivate');
    expect(rtmpUrlProblem('rtmp://u:p@host.com/x')).toBe('live.dest.errUrl');
    expect(rtmpUrlProblem('nem url')).toBe('live.dest.errUrl');
  });
});
