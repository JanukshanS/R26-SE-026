// import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
// import {
//   CAPTURE_TEXT_MUTED_WHITE,
//   CAPTURE_TEXT_WHITE,
//   SWEEP_ACTION_BG,
//   SWEEP_ACTION_BORDER,
//   SWEEP_MODAL_BACKDROP,
//   SWEEP_MODAL_BG,
//   SWEEP_MODAL_BORDER,
// } from '@/features/guided-capture/capture-ui-theme';

// type SweepDirectionModalProps = {
//   visible: boolean;
//   onSelectDirection: (direction: 'left' | 'right') => void;
// };

// /**
//  * Full-screen prompt shown when the capture screen loads (or after reset)
//  * until the user chooses which way they will sweep around the vehicle.
//  */
// export function SweepDirectionModal({ visible, onSelectDirection }: SweepDirectionModalProps) {
//   return (
//     <Modal
//       visible={visible}
//       transparent
//       animationType="fade"
//       statusBarTranslucent
//       onRequestClose={() => {
//         /* Block hardware back from closing without a choice — user must pick a direction. */
//       }}>
//       <View style={styles.backdrop}>
//         <View style={styles.card}>
//           <Text style={styles.title}>Capture  Direction</Text>
//           <Text style={styles.subtitle}>
//             Choose which way you will move around the vehicle. reset capture to change it
//           </Text>
//           <View style={styles.actions}>
//             <Pressable
//               style={({ pressed }) => [styles.choice, styles.choiceLeft, pressed && styles.choicePressed]}
//               onPress={() => onSelectDirection('left')}>
//               <Text style={styles.choiceArrow}>←</Text>
//               <Text style={styles.choiceLabel}>Move left</Text>
//               {/* <Text style={styles.choiceHint}>Counter-clockwise from your view</Text> */}
//             </Pressable>
//             <Pressable
//               style={({ pressed }) => [styles.choice, styles.choiceRight, pressed && styles.choicePressed]}
//               onPress={() => onSelectDirection('right')}>
//               <Text style={styles.choiceArrow}>→</Text>
//               <Text style={styles.choiceLabel}>Move right</Text>
//               {/* <Text style={styles.choiceHint}>Clockwise from your view</Text> */}
//             </Pressable>
//           </View>
//         </View>
//       </View>
//     </Modal>
//   );
// }

// const styles = StyleSheet.create({
//   backdrop: {
//     flex: 1,
//     backgroundColor: SWEEP_MODAL_BACKDROP,
//     justifyContent: 'center',
//     paddingHorizontal: 20,
//   },
//   card: {
//     backgroundColor: SWEEP_MODAL_BG,
//     borderRadius: 5,
//     padding: 20,
//     borderWidth: 2,
//     borderColor: SWEEP_MODAL_BORDER,
//   },
//   title: {
//     color: CAPTURE_TEXT_WHITE,
//     fontSize: 22,
//     fontWeight: '700',
//     marginBottom: 8,
//     textAlign: 'center',
//   },
//   subtitle: {
//     color: CAPTURE_TEXT_WHITE,
//     fontSize: 16,
//     lineHeight: 20,
//     textAlign: 'center',
//     marginBottom: 22,
//   },
//   actions: {
//     gap: 12,
//   },
//   choice: {
//     borderRadius: 10,
//     paddingVertical: 18,
//     paddingHorizontal: 16,
//     alignItems: 'center',
//     borderWidth: 2,
//   },
//   choiceLeft: {
//     backgroundColor: SWEEP_ACTION_BG,
//     borderColor: SWEEP_ACTION_BORDER,
//   },
//   choiceRight: {
//     backgroundColor: SWEEP_ACTION_BG,
//     borderColor: SWEEP_ACTION_BORDER,
//   },
//   choicePressed: {
//     opacity: 0.88,
//   },
//   choiceArrow: {
//     color: CAPTURE_TEXT_WHITE,
//     fontSize: 28,
//     fontWeight: '800',
//     marginBottom: 4,
//   },
//   choiceLabel: {
//     color: CAPTURE_TEXT_WHITE,
//     fontSize: 17,
//     fontWeight: '700',
//   },
//   choiceHint: {
//     color: CAPTURE_TEXT_MUTED_WHITE,
//     fontSize: 12,
//     marginTop: 4,
//     textAlign: 'center',
//   },
// });
