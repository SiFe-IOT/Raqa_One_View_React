import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Icon } from './Icon';
import { TvTextField } from './TvFields';
import { FocusTrap } from './FocusTrap';
import { InlineDialog } from './InlineDialog';
import { FocusButton } from './FocusButton';
import { useRemoteKeys } from '../hooks/useRemoteKeys';
import { useSvg } from './SvgFloorPlan';
import { ConfigurationStore } from '../services/configurationStore';
import { SiteImageConfig } from '../services/configTypes';
import { useObservable } from '../services/observable';
import { C } from '../theme/palette';
import { AppTheme } from '../theme/appTheme';
import { useAppSettings } from '../services/appSettings';

const two = (n: number) => String(n).padStart(2, '0');
const formatTime = (t: Date) =>
  `${two(t.getHours())}:${two(t.getMinutes())} - ${two(t.getDate())}/${two(t.getMonth() + 1)}/${t.getFullYear()}`;

const ThumbSvg = React.memo(function ThumbSvg({ xml }: { xml: string }) {
  return <SvgXml xml={xml} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />;
});

const Thumb = React.memo(function Thumb({ path }: { path: string }) {
  const { info } = useSvg(path);
  return (
    <View style={styles.thumb}>
      {info?.uri ? (
        <Image source={{ uri: info.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" fadeDuration={0} />
      ) : info?.rasterFailed ? (
        <ThumbSvg xml={info.xml} />
      ) : null}
    </View>
  );
});

const ROW_H = 64;

/**
 * Bottom sheet listing every loaded image. Drawn inline (not a native Modal)
 * so the remote's keys keep reaching the app:
 *   Up/Down choose an image, Right focuses its rename (edit) button,
 *   Left returns to the row, Select activates, Back closes.
 */
export function ImageHistorySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useObservable(ConfigurationStore);
  useAppSettings();
  const store = ConfigurationStore;
  const [renaming, setRenaming] = useState<SiteImageConfig | null>(null);
  const [label, setLabel] = useState('');
  const [sel, setSel] = useState(0);
  const [col, setCol] = useState(0); // 0 = row, 1 = rename, 2 = delete
  const [deleting, setDeleting] = useState<SiteImageConfig | null>(null);
  const listRef = useRef<FlatList<SiteImageConfig>>(null);
  const n = store.history.length;

  useEffect(() => {
    if (visible) { setSel(Math.max(0, store.activeIndex)); setCol(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || n === 0) return;
    try { listRef.current?.scrollToIndex({ index: Math.min(sel, n - 1), viewPosition: 0.5, animated: true }); } catch { /* not laid out yet */ }
  }, [sel, visible, n]);

  const startRename = (cfg: SiteImageConfig) => { setRenaming(cfg); setLabel(cfg.floorLabel); };
  const saveRename = () => {
    if (renaming) store.renameFloor(renaming.id, label);
    setRenaming(null);
  };

  useRemoteKeys((k) => {
    if (n === 0) { if (k === 'select') onClose(); return; }
    const cfg = store.history[Math.min(sel, n - 1)];
    if (k === 'up') setSel(Math.max(0, sel - 1));
    else if (k === 'down') setSel(Math.min(n - 1, sel + 1));
    else if (k === 'right') setCol(Math.min(2, col + 1));
    else if (k === 'left') setCol(Math.max(0, col - 1));
    else if (k === 'select' && cfg) {
      if (col === 1) startRename(cfg);
      else if (col === 2) setDeleting(cfg);
      else { store.setActive(cfg.id); onClose(); }
    }
  }, visible && renaming === null && deleting === null);

  return (
    <>
      {visible && (
        <FocusTrap active={renaming === null && deleting === null} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={[styles.sheet, { backgroundColor: AppTheme.card }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.title, { color: AppTheme.textPrimary }]}>Image History</Text>
            {n === 0 ? (
              <Text style={{ color: AppTheme.textSecondary, paddingBottom: 24, textAlign: 'center' }}>No images loaded yet.</Text>
            ) : (
              <FlatList
                ref={listRef}
                style={{ maxHeight: 320 }}
                data={store.history}
                keyExtractor={(c) => c.id}
                extraData={`${sel}-${col}`}
                getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
                renderItem={({ item, index }) => {
                  const rowSel = index === sel;
                  return (
                    <Pressable
                      focusable={false}
                      style={[styles.row, { height: ROW_H }, rowSel && col === 0 && styles.rowSel]}
                      onPress={() => { setSel(index); store.setActive(item.id); onClose(); }}
                    >
                      <Thumb path={item.imagePath} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text numberOfLines={1} style={{ color: AppTheme.textPrimary, fontSize: 17 }}>{item.floorLabel}</Text>
                        <Text style={{ color: AppTheme.textSecondary, fontSize: 14 }}>
                          {item.sensors.length} sensor(s) placed  •  {formatTime(item.loadedAt)}
                        </Text>
                      </View>
                      {index === store.activeIndex && <Icon name="check-circle" size={24} color={AppTheme.focusAccent} />}
                      <Pressable
                        focusable={false}
                        onPress={() => { setSel(index); startRename(item); }}
                        hitSlop={8}
                        style={[styles.editBtn, rowSel && col === 1 && styles.editBtnSel]}
                      >
                        <Icon name="edit" size={22} color={rowSel && col === 1 ? AppTheme.focusAccent : AppTheme.iconDim} />
                      </Pressable>
                      <Pressable
                        focusable={false}
                        onPress={() => { setSel(index); setDeleting(item); }}
                        hitSlop={8}
                        style={[styles.editBtn, rowSel && col === 2 && styles.delBtnSel]}
                      >
                        <Icon name="delete-outline" size={24} color={AppTheme.danger} />
                      </Pressable>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        </FocusTrap>
      )}

      <InlineDialog visible={renaming !== null} onRequestClose={() => setRenaming(null)}>
        <View style={styles.dialogScrim}>
          <View style={[styles.dialog, { backgroundColor: AppTheme.dialog }]}>
            <Text style={[styles.title, { padding: 0, marginBottom: 12, color: AppTheme.textPrimary }]}>Rename Floor</Text>
            <TvTextField label="Floor label" value={label} onChangeText={setLabel} autoFocus onSubmit={saveRename} />
            <View style={styles.actions}>
              <FocusButton label="Cancel" onPress={() => setRenaming(null)} />
              <FocusButton label="Save" variant="primary" onPress={saveRename} />
            </View>
          </View>
        </View>
      </InlineDialog>

      <InlineDialog visible={deleting !== null} onRequestClose={() => setDeleting(null)}>
        <View style={styles.dialogScrim}>
          <View style={[styles.dialog, { backgroundColor: AppTheme.dialog }]}>
            <Text style={[styles.title, { padding: 0, marginBottom: 12, color: AppTheme.textPrimary }]}>Delete image?</Text>
            <Text style={{ color: AppTheme.textPrimary, fontSize: 15, lineHeight: 21 }}>
              {`"${deleting?.floorLabel ?? ''}" and its ${deleting?.sensors.length ?? 0} placed sensor(s) will be removed. This cannot be undone.`}
            </Text>
            <View style={styles.actions}>
              {/* Cancel gets the initial focus so an accidental Select never deletes anything. */}
              <FocusButton label="Cancel" autoFocus onPress={() => setDeleting(null)} />
              <FocusButton
                label="Delete"
                variant="danger"
                onPress={() => { if (deleting) store.removeImage(deleting.id); setDeleting(null); }}
              />
            </View>
          </View>
        </View>
      </InlineDialog>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 16 },
  title: { fontSize: 20, fontWeight: 'bold', padding: 16 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  rowSel: { backgroundColor: 'rgba(100,255,218,0.10)', borderLeftColor: C.tealAccent },
  editBtn: { marginLeft: 8, padding: 6, borderRadius: 16, borderWidth: 2, borderColor: 'transparent' },
  delBtnSel: { borderColor: C.redAccent, backgroundColor: 'rgba(244,67,54,0.15)' },
  editBtnSel: { borderColor: C.tealAccent, backgroundColor: 'rgba(100,255,218,0.12)' },
  thumb: { width: 48, height: 48, borderRadius: 6, overflow: 'hidden', backgroundColor: C.white },
  dialogScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '50%', maxWidth: 420, borderRadius: 16, padding: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 },
});
