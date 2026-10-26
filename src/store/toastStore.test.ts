import { useToast } from '@/store/toastStore';

const toast = () => useToast.getState();

afterEach(() => toast().dismiss());

describe('toastStore', () => {
  it('megjelenik az akcióval együtt', () => {
    const onPress = jest.fn();
    toast().show('Klip törölve', { label: 'Visszavonás', onPress });
    expect(toast().message).toBe('Klip törölve');
    expect(toast().actionLabel).toBe('Visszavonás');
    toast().onAction?.();
    expect(onPress).toHaveBeenCalled();
  });

  it('az új toast felülírja a régit, és a RÉGI lejárata nem zárja be az újat', () => {
    toast().show('első');
    const firstId = toast().id;
    toast().show('második');
    toast().dismiss(firstId);
    expect(toast().message).toBe('második');
    toast().dismiss(toast().id);
    expect(toast().message).toBeNull();
  });

  it('akció nélküli toastnak nincs gombja', () => {
    toast().show('Mentve');
    expect(toast().actionLabel).toBeUndefined();
    expect(toast().onAction).toBeUndefined();
  });
});
