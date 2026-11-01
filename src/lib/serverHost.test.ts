import { serverHost } from '@/lib/backend';

describe('a worker címe', () => {
  it('fejlesztéskor a Metro címe nyer: kábelen is elérhető', () => {
    expect(serverHost('192.168.0.34', '169.254.1.2:8081', true)).toBe('169.254.1.2');
  });
  it('szimulátoron a localhost helyett az env-cím marad', () => {
    expect(serverHost('192.168.0.34', 'localhost:8081', true)).toBe('192.168.0.34');
    expect(serverHost('192.168.0.34', '127.0.0.1:8081', true)).toBe('192.168.0.34');
  });
  it('kiadott buildben az env dönt', () => {
    expect(serverHost('10.0.0.5', '169.254.1.2:8081', false)).toBe('10.0.0.5');
  });
  it('tartalék: Metro, majd localhost', () => {
    expect(serverHost(undefined, '192.168.0.9:8081', false)).toBe('192.168.0.9');
    expect(serverHost(' ', undefined, true)).toBe('localhost');
  });
});
