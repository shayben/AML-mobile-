import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogFile } from '../types';
import { AzureMLService } from '../services/azureMLService';

interface LogViewerProps {
  logFiles: LogFile[];
  service: AzureMLService;
}

const MAX_PREVIEW_LINES = 200;

export default function LogViewer({ logFiles, service }: LogViewerProps) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [logContents, setLogContents] = useState<Record<string, string>>({});
  const [loadingLog, setLoadingLog] = useState<string | null>(null);

  const handleToggleLog = useCallback(
    async (log: LogFile) => {
      if (expandedLog === log.name) {
        setExpandedLog(null);
        return;
      }

      setExpandedLog(log.name);

      if (!logContents[log.name]) {
        setLoadingLog(log.name);
        const content = await service.getLogContent(log.url);
        setLogContents((prev) => ({ ...prev, [log.name]: content }));
        setLoadingLog(null);
      }
    },
    [expandedLog, logContents, service],
  );

  if (logFiles.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No log files available.</Text>
      </View>
    );
  }

  const shortName = (name: string) => {
    const parts = name.split('/');
    return parts[parts.length - 1];
  };

  const folderName = (name: string) => {
    const parts = name.split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') + '/' : '';
  };

  return (
    <View>
      {logFiles.map((log) => {
        const isExpanded = expandedLog === log.name;
        const content = logContents[log.name];
        const isLoading = loadingLog === log.name;

        return (
          <View key={log.name} style={styles.logItem}>
            <TouchableOpacity
              style={styles.logHeader}
              onPress={() => handleToggleLog(log)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} ${log.name}`}
            >
              <Text style={styles.logArrow}>{isExpanded ? '▼' : '▶'}</Text>
              <View style={styles.logNameContainer}>
                <Text style={styles.logFolder}>{folderName(log.name)}</Text>
                <Text style={styles.logName}>{shortName(log.name)}</Text>
              </View>
            </TouchableOpacity>

            {isExpanded && (
              <View style={styles.logContent}>
                {isLoading ? (
                  <ActivityIndicator size="small" color="#0078D4" style={styles.logLoading} />
                ) : content ? (
                  <ScrollView horizontal style={styles.logScroll}>
                    <Text style={styles.logText} selectable>
                      {content.split('\n').length > MAX_PREVIEW_LINES
                        ? content.split('\n').slice(0, MAX_PREVIEW_LINES).join('\n') +
                          `\n\n--- Showing first ${MAX_PREVIEW_LINES} of ${content.split('\n').length} lines ---`
                        : content}
                    </Text>
                  </ScrollView>
                ) : (
                  <Text style={styles.logEmpty}>Empty log file.</Text>
                )}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  logItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F3F2F1',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FAFAFA',
  },
  logArrow: {
    fontSize: 10,
    color: '#605E5C',
    marginRight: 8,
    width: 14,
  },
  logNameContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  logFolder: {
    fontSize: 12,
    color: '#A19F9D',
  },
  logName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#201F1E',
  },
  logContent: {
    maxHeight: 400,
    borderTopWidth: 1,
    borderTopColor: '#F3F2F1',
  },
  logScroll: {
    padding: 12,
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#201F1E',
    lineHeight: 16,
  },
  logLoading: {
    padding: 20,
  },
  logEmpty: {
    padding: 12,
    color: '#A19F9D',
    fontSize: 12,
    fontStyle: 'italic',
  },
  empty: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#A19F9D',
  },
});
