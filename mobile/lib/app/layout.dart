import 'package:flutter/material.dart';

/// Nội dung nằm giữa màn hình rộng; các nút cuối trang tránh vùng điều hướng hệ thống.
class ResponsiveScaffold extends StatelessWidget {
  const ResponsiveScaffold({
    super.key,
    this.appBar,
    required this.body,
    this.backgroundColor,
    this.floatingActionButton,
    this.maxWidth = 1120,
  });

  final PreferredSizeWidget? appBar;
  final Widget body;
  final Color? backgroundColor;
  final Widget? floatingActionButton;
  final double maxWidth;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: appBar,
    backgroundColor: backgroundColor,
    floatingActionButton: floatingActionButton,
    body: SafeArea(
      top: false,
      child: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: SizedBox(width: double.infinity, child: body),
        ),
      ),
    ),
  );
}

/// Các thẻ tự xuống hàng theo chiều rộng thực tế, không khóa chiều cao theo tỉ lệ.
class ResponsiveColumns extends StatelessWidget {
  const ResponsiveColumns({
    super.key,
    required this.children,
    this.minColumnWidth = 154,
    this.maxColumns = 4,
    this.spacing = 8,
  });

  final List<Widget> children;
  final double minColumnWidth;
  final int maxColumns;
  final double spacing;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final count =
          ((constraints.maxWidth + spacing) / (minColumnWidth + spacing))
              .floor()
              .clamp(1, maxColumns);
      final width = (constraints.maxWidth - spacing * (count - 1)) / count;
      return Wrap(
        spacing: spacing,
        runSpacing: spacing,
        children: [
          for (final child in children) SizedBox(width: width, child: child),
        ],
      );
    },
  );
}

/// Nền thanh tab chạm đáy màn hình; chỉ phần nút chừa đúng inset hệ thống hiện tại.
class AppNavigationBar extends StatelessWidget {
  const AppNavigationBar({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.destinations,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<Widget> destinations;

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: Theme.of(context).colorScheme.surface,
    child: Align(
      alignment: Alignment.bottomCenter,
      heightFactor: 1,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 720),
        child: NavigationBar(
          selectedIndex: selectedIndex,
          onDestinationSelected: onDestinationSelected,
          height: Theme.of(context).platform == TargetPlatform.iOS ? 60 : 64,
          maintainBottomViewPadding: true,
          destinations: destinations,
        ),
      ),
    ),
  );
}

/// Bottom sheet có thể cuộn khi bàn phím mở trên điện thoại nhỏ hoặc iPad chia đôi.
class FormSheet extends StatelessWidget {
  const FormSheet({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        MediaQuery.viewInsetsOf(context).bottom + 20,
      ),
      child: child,
    ),
  );
}

/// Giữ danh sách trong bottom sheet ở phía trên thanh điều hướng hệ thống.
class SafeDraggableSheet extends StatelessWidget {
  const SafeDraggableSheet({
    super.key,
    required this.builder,
    this.expand = false,
    this.initialChildSize = .5,
    this.minChildSize = .25,
    this.maxChildSize = 1,
  });

  final ScrollableWidgetBuilder builder;
  final bool expand;
  final double initialChildSize, minChildSize, maxChildSize;

  @override
  Widget build(BuildContext context) => SafeArea(
    top: false,
    child: DraggableScrollableSheet(
      expand: expand,
      initialChildSize: initialChildSize,
      minChildSize: minChildSize,
      maxChildSize: maxChildSize,
      builder: builder,
    ),
  );
}
