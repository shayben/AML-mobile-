import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { RootStackParamList, MonthlyCostSummary, CostForecast, CostBreakdownItem } from '../types';
import { AzureMLService } from '../services/azureMLService';
import { loadAuthTokens, getCached, setCache } from '../services/storageService';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Costs'>;
};

const CHART_WIDTH = Dimensions.get('window').width - 48;

function fmtCurrency(amount: number, currency: string): string {
  return `${currency === 'USD' ? '$' : currency + ' '}${amount.toFixed(2)}`;
}

function fmtShort(amount: number): string {
  if (amount >= 1000) return `$${(amount / 1000).toFixed(1)}k`;
  return `$${amount.toFixed(0)}`;
}

export default function CostsScreen({ navigation }: Props) {
  const [currentMonth, setCurrentMonth] = useState<MonthlyCostSummary | null>(null);
  const [prevMonth, setPrevMonth] = useState<MonthlyCostSummary | null>(null);
  const [forecast, setForecast] = useState<CostForecast | null>(null);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyCostSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCosts = useCallback(
    async (silent = false, bypassCache = false) => {
      if (!silent) setLoading(true);
      try {
        const tokens = await loadAuthTokens();
        if (!tokens || !tokens.subscriptionId) {
          navigation.replace('Login');
          return;
        }

        const cacheKey = `costs:${tokens.subscriptionId}`;

        // Try cache first (15-min TTL)
        if (!bypassCache) {
          const cached = await getCached<{
            current: MonthlyCostSummary;
            prev: MonthlyCostSummary | null;
            forecast: CostForecast;
            trend: MonthlyCostSummary[];
          }>(cacheKey);
          if (cached) {
            setCurrentMonth(cached.current);
            setPrevMonth(cached.prev);
            setForecast(cached.forecast);
            setMonthlyTrend(cached.trend);
            setError(null);
            setLoading(false);
            setRefreshing(false);
            return;
          }
        }

        const service = new AzureMLService({
          accessToken: tokens.accessToken,
          subscriptionId: tokens.subscriptionId,
        });

        // Serialize all cost queries to avoid 429 rate limits
        const current = await service.getMonthlyCosts(0);
        setCurrentMonth(current);

        const trend = await service.getMultiMonthCosts(6);
        setMonthlyTrend(trend);

        const prevFromTrend = trend.length >= 2 ? trend[trend.length - 2] : null;
        setPrevMonth(prevFromTrend);

        const fcast = await service.getCostForecast();
        setForecast(fcast);

        // Cache the results
        await setCache(cacheKey, { current, prev: prevFromTrend, forecast: fcast, trend });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load cost data.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [navigation],
  );

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchCosts(true, true);
  };

  if (loading) return <LoadingSpinner message="Loading cost data…" />;
  if (error) return <ErrorMessage message={error} onRetry={() => fetchCosts()} />;

  const currency = currentMonth?.currency || 'USD';
  const monthToDate = currentMonth?.totalCost ?? 0;
  const prevTotal = prevMonth?.totalCost ?? 0;
  const forecastTotal = (forecast?.estimatedCost ?? 0) + monthToDate;
  const change = prevTotal > 0 ? ((monthToDate - prevTotal) / prevTotal) * 100 : 0;
  const dayOfMonth = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const burnRate = dayOfMonth > 0 ? monthToDate / dayOfMonth : 0;
  const linearEstimate = burnRate * daysInMonth;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Month to Date</Text>
          <Text style={styles.summaryValue}>{fmtCurrency(monthToDate, currency)}</Text>
          <Text style={styles.summarySubtext}>Day {dayOfMonth} of {daysInMonth}</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Forecast</Text>
          <Text style={styles.summaryValue}>{fmtCurrency(forecastTotal > 0 ? forecastTotal : linearEstimate, currency)}</Text>
          <Text style={styles.summarySubtext}>
            {forecastTotal > 0 ? 'Azure estimate' : 'Linear estimate'}
          </Text>
        </View>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Last Month</Text>
          <Text style={styles.summaryValue}>{fmtCurrency(prevTotal, currency)}</Text>
          <Text style={[styles.summarySubtext, change > 0 ? styles.costUp : styles.costDown]}>
            {prevTotal > 0 ? `${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs MTD` : '—'}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Daily Burn Rate</Text>
          <Text style={styles.summaryValue}>{fmtCurrency(burnRate, currency)}</Text>
          <Text style={styles.summarySubtext}>avg/day</Text>
        </View>
      </View>

      {/* Daily Costs Chart */}
      {currentMonth && currentMonth.dailyCosts.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Daily Costs — {currentMonth.month}</Text>
          <DailyCostChart data={currentMonth.dailyCosts} />
        </View>
      )}

      {/* Monthly Trend */}
      {monthlyTrend.length > 1 && (
        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Monthly Trend (ML Services)</Text>
          <MonthlyTrendChart data={monthlyTrend} />
        </View>
      )}

      {/* Breakdown by Resource Group */}
      {currentMonth && currentMonth.byResourceGroup.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>By Resource Group</Text>
          <BreakdownTable items={currentMonth.byResourceGroup} total={monthToDate} currency={currency} />
        </View>
      )}

      {/* Breakdown by Meter Category */}
      {currentMonth && currentMonth.byMeterCategory.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>By Meter Category</Text>
          <BreakdownTable items={currentMonth.byMeterCategory} total={monthToDate} currency={currency} />
        </View>
      )}
    </ScrollView>
  );
}

function DailyCostChart({ data }: { data: { date: string; cost: number }[] }) {
  const maxLabels = 8;
  const step = Math.max(1, Math.ceil(data.length / maxLabels));
  const labels = data.map((d, i) => (i % step === 0 ? d.date.slice(8) : ''));
  const values = data.map((d) => d.cost);

  if (values.every((v) => v === 0)) {
    return <Text style={styles.emptyChart}>No cost data for this period.</Text>;
  }

  return (
    <BarChart
      data={{ labels, datasets: [{ data: values }] }}
      width={CHART_WIDTH}
      height={200}
      yAxisLabel="$"
      yAxisSuffix=""
      fromZero
      chartConfig={{
        backgroundColor: '#fff',
        backgroundGradientFrom: '#fff',
        backgroundGradientTo: '#fff',
        decimalPlaces: 0,
        color: (opacity = 1) => `rgba(0, 120, 212, ${opacity})`,
        labelColor: () => '#605E5C',
        barPercentage: 0.6,
        propsForBackgroundLines: { stroke: '#F3F2F1' },
      }}
      style={styles.chart}
    />
  );
}

function MonthlyTrendChart({ data }: { data: MonthlyCostSummary[] }) {
  const labels = data.map((d) => d.month.slice(5)); // "MM"
  const values = data.map((d) => d.totalCost);

  if (values.every((v) => v === 0)) {
    return <Text style={styles.emptyChart}>No historical cost data.</Text>;
  }

  return (
    <BarChart
      data={{ labels, datasets: [{ data: values }] }}
      width={CHART_WIDTH}
      height={200}
      yAxisLabel="$"
      yAxisSuffix=""
      fromZero
      chartConfig={{
        backgroundColor: '#fff',
        backgroundGradientFrom: '#fff',
        backgroundGradientTo: '#fff',
        decimalPlaces: 0,
        color: (opacity = 1) => `rgba(16, 124, 16, ${opacity})`,
        labelColor: () => '#605E5C',
        barPercentage: 0.5,
        propsForBackgroundLines: { stroke: '#F3F2F1' },
      }}
      style={styles.chart}
    />
  );
}

function BreakdownTable({
  items,
  total,
  currency,
}: {
  items: CostBreakdownItem[];
  total: number;
  currency: string;
}) {
  return (
    <View>
      {items.map((item) => {
        const pct = total > 0 ? (item.cost / total) * 100 : 0;
        return (
          <View key={item.name} style={styles.breakdownRow}>
            <View style={styles.breakdownNameCol}>
              <Text style={styles.breakdownName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${Math.min(pct, 100)}%` }]} />
              </View>
            </View>
            <View style={styles.breakdownValueCol}>
              <Text style={styles.breakdownValue}>{fmtCurrency(item.cost, currency)}</Text>
              <Text style={styles.breakdownPct}>{pct.toFixed(1)}%</Text>
            </View>
          </View>
        );
      })}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{fmtCurrency(total, currency)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F8F8' },
  content: { padding: 16, paddingBottom: 32 },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#A19F9D',
    marginBottom: 4,
    fontWeight: '500',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#201F1E',
  },
  summarySubtext: {
    fontSize: 11,
    color: '#A19F9D',
    marginTop: 2,
  },
  costUp: { color: '#A80000' },
  costDown: { color: '#107C10' },
  chartCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#201F1E',
    marginBottom: 12,
  },
  chart: {
    borderRadius: 8,
    marginLeft: -12,
  },
  emptyChart: {
    textAlign: 'center',
    color: '#A19F9D',
    fontSize: 13,
    paddingVertical: 20,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F2F1',
  },
  breakdownNameCol: {
    flex: 1,
    marginRight: 12,
  },
  breakdownName: {
    fontSize: 13,
    color: '#201F1E',
    marginBottom: 4,
  },
  barBg: {
    height: 4,
    backgroundColor: '#F3F2F1',
    borderRadius: 2,
  },
  barFill: {
    height: 4,
    backgroundColor: '#0078D4',
    borderRadius: 2,
  },
  breakdownValueCol: {
    alignItems: 'flex-end',
    minWidth: 80,
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#201F1E',
  },
  breakdownPct: {
    fontSize: 11,
    color: '#A19F9D',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#201F1E',
  },
  totalValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#201F1E',
  },
});
