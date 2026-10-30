import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { InlineDialog } from './InlineDialog';
import { FocusButton } from './FocusButton';
import { FocusTrap } from './FocusTrap';
import { useRemoteKeys } from '../hooks/useRemoteKeys';
import { TvTextField } from './TvFields';
import { PlacedSensor, SensorTypeUi } from '../services/configTypes';
import { useAppSettings } from '../services/appSettings';
import { AppTheme } from '../theme/appTheme';

interface Props {
  sensor: PlacedSensor | null;
  onRemove: (s: PlacedSensor) => void;
  onClose: (result: PlacedSensor | null) => void;
}

/** Edit an already-placed pin: name/location editable, plus Remove. */
export function EditSensorDialog({ sensor, onRemove, onClose }: Props) {
  useAppSettings();
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  // Remote focus: 0 Name, 1 Location, 2 Remove, 3 Cancel, 4 Save.
  const [sel, setSel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [claim, setClaim] = useState(0);
  const [nameTick, setNameTick] = useState(0);
  const [locTick, setLocTick] = useState(0);

  useEffect(() => {
    if (sensor) { setSel(0); setName(sensor.name); setLocation(sensor.location); }
  }, [sensor]);

  const save = () => {
    if (!sensor) return;
    onClose({
      ...sensor,
      name: name.trim() === '' ? sensor.name : name.trim(),
      location: location.trim(),
    });
  };
  const remove = () => { if (sensor) { onRemove(sensor); onClose(null); } };

  // The dialog owns the D-pad itself (a FocusTrap keeps native focus on it), so
  // focus is never lost when the keyboard closes after editing.
  useRemoteKeys((k) => {
    if (k === 'up') setSel((s) => (s >= 2 ? 1 : Math.max(0, s - 1)));
    else if (k === 'down') setSel((s) => (s < 2 ? s + 1 : s));
    else if (k === 'left') setSel((s) => (s > 2 ? s - 1 : s));
    else if (k === 'right') setSel((s) => (s >= 2 && s < 4 ? s + 1 : s));
    else if (k === 'select') {
      if (sel === 0) setNameTick((t) => t + 1);
      else if (sel === 1) setLocTick((t) => t + 1);
      else if (sel === 2) remove();
      else if (sel === 3) onClose(null);
      else save();
    }
  }, !!sensor && !typing);

  if (!sensor) return null;
  const ui = SensorTypeUi[sensor.type];

  return (
    <InlineDialog visible onRequestClose={() => onClose(null)}>
      <FocusTrap active claimKey={claim} style={styles.scrim}>
        <View style={[styles.dialog, { backgroundColor: AppTheme.dialog }]}>
          <View style={styles.titleRow}>
            <Icon name={ui.icon} size={24} color={ui.color} />
            <Text numberOfLines={1} style={[styles.title, { color: AppTheme.textPrimary }]}>Slave {sensor.slaveId} - {sensor.zoneLabel}</Text>
          </View>

          <TvTextField
            external highlighted={sel === 0} startEdit={nameTick}
            onEditingChange={(e) => { setTyping(e); if (!e) setClaim((c) => c + 1); }}
            label="Name" value={name} onChangeText={setName} returnKeyType="done"
          />
          <View style={{ height: 12 }} />
          <TvTextField
            external highlighted={sel === 1} startEdit={locTick}
            onEditingChange={(e) => { setTyping(e); if (!e) setClaim((c) => c + 1); }}
            label="Location" value={location} onChangeText={setLocation} returnKeyType="done"
          />

          <View style={styles.actions}>
            <FocusButton label="Remove" variant="dangerText" highlighted={sel === 2} onPress={remove} />
            <FocusButton label="Cancel" highlighted={sel === 3} onPress={() => onClose(null)} />
            <FocusButton label="Save" variant="primary" highlighted={sel === 4} onPress={save} />
          </View>
        </View>
      </FocusTrap>
    </InlineDialog>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '60%', maxWidth: 460, borderRadius: 16, padding: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { flex: 1, fontSize: 20, fontWeight: '600', marginLeft: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 },
});