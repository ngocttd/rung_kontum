import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';
import '../../widgets/items.dart';

/// M09 – Tin tức: danh mục, tìm kiếm, tin nổi bật. Nội dung công bố qua CMS web, đã kiểm duyệt.
class NewsPage extends ConsumerStatefulWidget {
  const NewsPage({super.key, this.standalone = false});
  final bool standalone;
  @override
  ConsumerState<NewsPage> createState() => _NewsPageState();
}

class _NewsPageState extends ConsumerState<NewsPage> {
  String cat = '';
  String q = '';

  @override
  Widget build(BuildContext context) {
    final cats = ((ref.watch(sessionProvider).catalogs['news_categories'] as Map?) ?? {}).cast<String, dynamic>();
    final v = ref.watch(newsProvider(cat));
    return Scaffold(
      appBar: AppBar(title: const Text('Tin tức'), automaticallyImplyLeading: widget.standalone),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 4),
          child: TextField(decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Tìm kiếm tin tức…', isDense: true), onChanged: (t) => setState(() => q = t.trim().toLowerCase())),
        ),
        SizedBox(
          height: 46,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), children: [
            Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: ChoiceChip(label: const Text('Tất cả'), selected: cat.isEmpty, onSelected: (_) => setState(() => cat = ''))),
            for (final e in cats.entries)
              Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: ChoiceChip(label: Text((e.value is Map ? e.value['label'] : e.value).toString()), selected: cat == e.key, onSelected: (_) => setState(() => cat = e.key))),
          ]),
        ),
        Expanded(
          child: AsyncView(
            value: v,
            onRetry: () => ref.invalidate(newsProvider(cat)),
            builder: (Loaded<J> l) {
              final items = ((l.data['items'] as List?) ?? []).cast<Map>().map((e) => e.cast<String, dynamic>()).where((n) => q.isEmpty || n['title'].toString().toLowerCase().contains(q)).toList();
              if (items.isEmpty) return const EmptyView('Không có tin phù hợp');
              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(newsProvider(cat)),
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 20),
                  itemCount: items.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (_, i) => NewsTile(items[i]),
                ),
              );
            },
          ),
        ),
      ]),
    );
  }
}

/// M10 – Chi tiết tin: nội dung, nguồn, chia sẻ, tin liên quan.
class NewsDetailPage extends ConsumerWidget {
  const NewsDetailPage({super.key, required this.slug});
  final String slug;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final v = ref.watch(newsDetailProvider(slug));
    final api = ref.watch(apiProvider);
    return Scaffold(
      appBar: AppBar(actions: [
        IconButton(icon: const Icon(Icons.share_outlined), onPressed: () {
          final d = v.asData?.value.data;
          if (d != null) SharePlus.instance.share(ShareParams(text: '${d['title']}\n${api.url(d['web_url'] as String?)}'));
        }),
      ]),
      body: AsyncView(
        value: v,
        onRetry: () => ref.invalidate(newsDetailProvider(slug)),
        builder: (Loaded<J> l) {
          final d = l.data;
          final paras = (d['body']?.toString() ?? '').split(RegExp(r'\n\s*\n')).where((p) => p.trim().isNotEmpty);
          final related = ((d['related'] as List?) ?? []).cast<Map>();
          return ListView(padding: const EdgeInsets.all(16), children: [
            Text(d['title'].toString(), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: AppColors.navy, height: 1.25)),
            const SizedBox(height: 8),
            Row(children: [
              const Icon(Icons.schedule, size: 15, color: AppColors.muted),
              const SizedBox(width: 4),
              Text(fmtDateTime(d['published_at']), style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
              const SizedBox(width: 12),
              const Icon(Icons.visibility_outlined, size: 15, color: AppColors.muted),
              const SizedBox(width: 4),
              Text('${d['views'] ?? 0}', style: const TextStyle(color: AppColors.muted, fontSize: 12.5)),
              const Spacer(),
              StatusChip(d['category_label']?.toString() ?? '', color: AppColors.forest, dense: true),
            ]),
            if (d['status'] != 'published') ...[const SizedBox(height: 8), const NoticeBox('Bài đang chờ cán bộ duyệt nội dung.', warn: true)],
            const SizedBox(height: 12),
            ClipRRect(borderRadius: BorderRadius.circular(12), child: NetImage(d['image'] as String?, height: 200, fallback: 'assets/images/forest-patrol-small.webp')),
            const SizedBox(height: 12),
            if (d['summary'] != null) Text(d['summary'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, height: 1.5)),
            for (final p in paras) Padding(padding: const EdgeInsets.only(top: 10), child: Text(p.trim(), style: const TextStyle(fontSize: 15, height: 1.55))),
            if (d['source_url'] != null && d['source_url'].toString().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: OutlinedButton.icon(icon: const Icon(Icons.open_in_new), label: const Text('Nguồn tin / tệp đính kèm'), onPressed: () => launchUrl(Uri.parse(api.url(d['source_url'] as String)), mode: LaunchMode.externalApplication)),
              ),
            if (related.isNotEmpty) ...[
              const SizedBox(height: 18),
              const Text('Tin liên quan', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              for (final r in related) NewsTile(r.cast<String, dynamic>()),
            ],
            if (d['slug'] != null) TextButton(onPressed: () => context.pop(), child: const Text('Quay lại')),
          ]);
        },
      ),
    );
  }
}
