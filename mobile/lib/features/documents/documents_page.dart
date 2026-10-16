import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../core/data.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../widgets/common.dart';

/// M13 – Tài liệu – bản đồ PDF: lọc, tìm kiếm, xem/tải tệp công khai. Máy chủ kiểm tra quyền tải (TC10).
class DocumentsPage extends ConsumerStatefulWidget {
  const DocumentsPage({super.key});
  @override
  ConsumerState<DocumentsPage> createState() => _DocumentsPageState();
}

class _DocumentsPageState extends ConsumerState<DocumentsPage> {
  String cat = '';
  String q = '';
  static const cats = [('', 'Tất cả'), ('ban-do-chuyen-de', 'Bản đồ chuyên đề'), ('van-ban-phap-ly', 'Văn bản'), ('bao-cao-chuyen-nganh', 'Báo cáo'), ('quy-hoach', 'Quy hoạch')];

  @override
  Widget build(BuildContext context) {
    final v = ref.watch(documentsProvider(cat));
    final api = ref.watch(apiProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Tài liệu – Bản đồ PDF')),
      body: Column(children: [
        Padding(padding: const EdgeInsets.fromLTRB(14, 8, 14, 0), child: TextField(decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Tìm kiếm tài liệu…', isDense: true), onChanged: (t) => setState(() => q = t.trim().toLowerCase()))),
        SizedBox(
          height: 46,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), children: [
            for (final c in cats) Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: ChoiceChip(label: Text(c.$2), selected: cat == c.$1, onSelected: (_) => setState(() => cat = c.$1))),
          ]),
        ),
        Expanded(
          child: AsyncView(
            value: v,
            onRetry: () => ref.invalidate(documentsProvider(cat)),
            builder: (Loaded<J> l) {
              final items = ((l.data['items'] as List?) ?? []).cast<Map>().where((d) => q.isEmpty || d['title'].toString().toLowerCase().contains(q)).toList();
              if (items.isEmpty) return const EmptyView('Không có tài liệu phù hợp');
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 20),
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (_, i) {
                  final d = items[i];
                  final type = (d['type'] ?? 'pdf').toString();
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(vertical: 4),
                    leading: Container(
                      width: 44,
                      height: 52,
                      decoration: BoxDecoration(color: type == 'pdf' ? const Color(0xFFFDECEA) : AppColors.forestLight, borderRadius: BorderRadius.circular(8)),
                      child: Icon(type == 'pdf' ? Icons.picture_as_pdf : type == 'mpk' || type == 'package' ? Icons.inventory_2_outlined : Icons.map_outlined, color: type == 'pdf' ? AppColors.fire : AppColors.forest),
                    ),
                    title: Text(d['title'].toString(), maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                    subtitle: Text([d['category_label'], fmtBytes(d['bytes'] as num?), d['issued'] == null ? null : fmtDate(d['issued'])].where((x) => x != null && x.toString().isNotEmpty).join(' · '), style: const TextStyle(fontSize: 12)),
                    trailing: IconButton(
                      tooltip: 'Tải về',
                      icon: const Icon(Icons.download_outlined, color: AppColors.forest),
                      onPressed: () => launchUrl(Uri.parse('${api.url(d['url'] as String)}?tai=1'), mode: LaunchMode.externalApplication),
                    ),
                    onTap: () => launchUrl(Uri.parse(api.url(d['url'] as String)), mode: LaunchMode.externalApplication),
                  );
                },
              );
            },
          ),
        ),
      ]),
    );
  }
}
