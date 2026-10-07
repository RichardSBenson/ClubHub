-- 048 — dan grades are named "1st dan" to "8th dan", like the kyu grades ("4th kyu").
-- applied-when: select not exists (select 1 from grade where is_dan and label in ('Shodan','Nidan','Sandan','Yondan','Godan','Shihan','Renshi','Kyoshi','Hanshi'))
--
-- Shodan, Nidan and so on are the Japanese words for the same numbers, and Shihan, Renshi, Kyoshi and
-- Hanshi are TITLES (they are already in the titles table, and follow the grade). Showing the number is
-- what people write on a roll and what the dojo pages say. Grade rows are renamed in place, so every
-- grading record and grade authority that points at them is untouched.

update grade g
   set label = x.label
  from (values
    (11, '1st dan'), (12, '2nd dan'), (13, '3rd dan'), (14, '4th dan'),
    (15, '5th dan'), (16, '6th dan'), (17, '7th dan'), (18, '8th dan')
  ) as x(rank_order, label)
 where g.is_dan and g.rank_order = x.rank_order
   and g.label in ('Shodan','Nidan','Sandan','Yondan','Godan','Shihan','Renshi','Kyoshi','Hanshi');
