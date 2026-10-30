import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { InlineDialog } from './InlineDialog';
import { FocusButton } from './FocusButton';
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

  useEffect(() => {
    if (sensor) { setName(sensor.name); setLocation(sensor.location); }
  }, [sensor]);

  if (!sensor) return null;
  const ui = SensorTypeUi[sensor.type];

  return (
    <InlineDialog visible onRequestClose={() => onClose(null)}>
      <View style={styles.scrim}>
        <View style={[styles.dialog, { backgroundColor: AppTheme.dialog }]}>
          <View style={styles.titleRow}>
            <Icon name={ui.icon} size={24} color={ui.color} />
            <Text numberOfLines={1} style={[styles.title, { color: AppTheme.textPrimary }]}>Slave {sensor.slaveId} - {sensor.zoneLabel}</Text>
          </View>

          <TvTextField label="Name" value={name} onChangeText={setName} autoFocus returnKeyType="next" />
          <View style={{ height: 12 }} />
          <TvTextField label="Location" value={location} onChangeText={setLocation} />

          <View style={styles.actions}>
            <FocusButton label="Remove" variant="dangerText" onPress={() => { onRemove(sensor); onClose(null); }} />
            <FocusButton label="Cancel" onPress={() => onClose(null)} />
            <FocusButton
              label="Save"
              variant="primary"
              onPress={() => onClose({
                ...sensor,
                name: name.trim() === '' ? sensor.name : name.trim(),
                location: location.trim(),
              })}
            />
          </View>
        </View>
      </View>
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
