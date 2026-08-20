import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { C } from "../constants/colors";

interface CardProps {
  children: React.ReactNode;
  style?: object;
}

export function Card({ children, style }: CardProps) {
  return (
    <View style={[styles.card, style]}>
      {children}
    </View>
  );
}

interface SHProps {
  title: string;
  action?: string;
  onAction?: () => void;
}

import { TouchableOpacity } from "react-native";
import { ChevronRight } from "lucide-react-native";

export function SH({ title, action, onAction }: SHProps) {
  return (
    <View style={styles.shRow}>
      <Text style={styles.shTitle}>{title}</Text>
      {action && (
        <TouchableOpacity style={styles.shAction} onPress={onAction}>
          <Text style={styles.shActionText}>{action}</Text>
          <ChevronRight size={10} color={C.peach} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  shRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  shTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: C.text,
    fontFamily: "System",
  },
  shAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  shActionText: {
    fontSize: 10,
    fontWeight: "600",
    color: C.peach,
  },
});
