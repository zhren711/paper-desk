// “打开示例论文”时写入的内容。题目里标了“示例”，可以随时删除。
const q1zh = '交通流预测很重要，现在城市越来越堵，如果能预测未来的流量，交通管理部门就可以提前调整信号灯，还有出行的人也能选别的路。所以很多人在研究这个问题，它是智能交通系统的核心。';
const q1pl = '交通流预测是智能交通系统的核心任务之一。随着城市拥堵日益加剧，准确预测未来一段时间的路网流量，既能帮助交通管理部门提前调整信号配时，也能为出行者选择路径提供依据。因此，交通流预测长期受到学界与业界的广泛关注。';

export function examplePaper() {
  return {
    meta: {
      title: '面向城市路网的时空图神经网络交通流预测（示例）',
      titleEn: 'Spatio-Temporal Graph Neural Networks for Urban Traffic Flow Forecasting',
      field: '交通工程 · 机器学习',
      strength: 'medium',
      spelling: 'US',
      glossary: [
        { zh: '交通流预测', en: 'traffic flow forecasting' },
        { zh: '图神经网络', en: 'graph neural network (GNN)' },
        { zh: '检测器', en: 'loop detector' },
      ],
      order: ['sIntro', 'sRelated', 'sMethod', 'sExp', 'sConc'],
      zhComments: true,
    },
    sections: {
      sIntro: {
        titleZh: '引言', titleEn: 'Introduction',
        points: [
          { id: 'pa', text: '交通流预测对交通管理与出行决策的重要性' },
          { id: 'pb', text: '现有方法难以同时刻画时间与空间依赖' },
          { id: 'pc', text: '本文提出时空图模型及三点贡献' },
        ],
        paragraphs: [
          {
            id: 'q1', zh: q1zh, polished: q1pl, polishedFrom: q1zh, enFrom: q1pl, point: 'pa',
            notes: ['把结论“智能交通系统的核心”提前为主题句', '“很多人在研究”改为由实际需求推出研究关注的因果关系', '删去“现在”“还有”等口语化表达'],
            en: 'Traffic flow forecasting is one of the core tasks of intelligent transportation systems. As urban congestion continues to intensify, accurately predicting network-wide traffic flow over the near future can help traffic authorities adjust signal timing in advance and give travelers a sound basis for route choice. Consequently, traffic flow forecasting has long attracted wide attention from both academia and industry.',
          },
          {
            id: 'q2', point: 'pb', polished: '', polishedFrom: '', en: '', enFrom: '', notes: [],
            zh: '但是现有的方法大多数只考虑了时间上的变化，比如ARIMA和LSTM，它们把每个检测器当成独立的序列，忽略了路网的结构。也有一些方法用CNN处理空间，但是路网不是规则的网格，所以效果不好。',
          },
        ],
      },
      sRelated: { titleZh: '相关工作', titleEn: 'Related Work', paragraphs: [], points: [{ id: 'pd', text: '经典时间序列方法' }, { id: 'pe', text: '深度学习时序模型' }, { id: 'pf', text: '图神经网络在交通中的应用' }] },
      sMethod: { titleZh: '方法', titleEn: 'Method', paragraphs: [], points: [{ id: 'pg', text: '将路网建模为有向图' }, { id: 'ph', text: '时空卷积模块' }, { id: 'pi', text: '损失函数与训练策略' }] },
      sExp: { titleZh: '实验', titleEn: 'Experiments', paragraphs: [], points: [{ id: 'pj', text: '数据集与评价指标' }, { id: 'pk', text: '对比实验结果' }, { id: 'pl', text: '消融实验' }] },
      sConc: { titleZh: '结论', titleEn: 'Conclusion', paragraphs: [], points: [{ id: 'pm', text: '总结贡献' }, { id: 'pn', text: '局限与未来工作' }] },
    },
  };
}
